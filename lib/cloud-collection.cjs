const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { loadConfig } = require('./supabase-sync.cjs');

function cloudClient(env = process.env) {
  const config = loadConfig(env);
  if (!config || !env.BROWSERBASE_API_KEY || !env.BROWSERBASE_CONTEXT_ID) throw new Error('Cloud collection is not configured.');
  return { config, db: createClient(config.url, config.secret, { auth: { persistSession: false, autoRefreshToken: false } }) };
}

async function authorize(db, ownerId, authorization) {
  const token = /^Bearer (.+)$/i.exec(authorization || '')?.[1];
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && data.user?.id === ownerId;
}

async function claimBatch(db, ownerId) {
  // A terminated function leaves a lease behind. Only expire it beyond the function's five-minute limit.
  const { error: staleError } = await db.from('collection_batches').update({ status: 'needs_attention', detail: 'Collection timed out. Try Get new picks again.', completed_at: new Date().toISOString() })
    .eq('owner_id', ownerId).eq('status', 'collecting').lt('started_at', new Date(Date.now() - 7 * 60000).toISOString());
  if (staleError) throw staleError;
  const { data, error } = await db.from('collection_batches').insert({ owner_id: ownerId, status: 'collecting', detail: 'Collecting new Poshmark suggestions.' }).select('id').single();
  if (error?.code === '23505') return null;
  if (error) throw error;
  return data.id;
}

async function runBatch(db, batchId, env = process.env) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poshmark-cloud-'));
  let browserbase;
  let session;
  try {
    const { default: Browserbase } = await import('@browserbasehq/sdk');
    browserbase = new Browserbase({ apiKey: env.BROWSERBASE_API_KEY });
    session = await browserbase.sessions.create({ browserSettings: { context: { id: env.BROWSERBASE_CONTEXT_ID, persist: true } }, api_timeout: 270 });
    const { collect } = require('../collect.cjs');
    const result = await collect({ connectUrl: session.connectUrl, directory, sync: true, batchId });
    const { error } = await db.from('collection_batches').update({ status: result.status, detail: result.detail, listing_count: result.collected, completed_at: new Date().toISOString() }).eq('id', batchId);
    if (error) throw error;
    return { batchId, status: result.status, listings: result.collected, images: result.cloud.images };
  } catch (error) {
    const detail = error.message.startsWith('Poshmark feed') || error.message.startsWith('Cloud collection or sync') ? error.message : 'Cloud collection failed. Check Browserbase access and quota, then try again.';
    const { error: statusError } = await db.from('collection_batches').update({ status: 'needs_attention', detail, completed_at: new Date().toISOString() }).eq('id', batchId);
    if (statusError) console.error('Collection status could not be saved.');
    console.error(JSON.stringify({ event: 'cloud_collection_failed', batchId, detail }));
    return { batchId, status: 'needs_attention', detail };
  } finally {
    if (session) await browserbase.sessions.update(session.id, { status: 'REQUEST_RELEASE' }).catch(() => {});
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected temporary cache path.');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { cloudClient, authorize, claimBatch, runBatch };
