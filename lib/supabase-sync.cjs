const fs = require('node:fs');
const path = require('node:path');

function loadConfig(env = process.env) {
  const names = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_USER_ID'];
  const values = Object.fromEntries(names.map(name => [name, env[name]?.trim()]));
  const present = names.filter(name => values[name]);
  if (present.length === 0) return null;
  const missing = names.filter(name => !values[name]);
  if (missing.length) throw new Error('Missing Supabase settings: ' + missing.join(', '));
  const url = new URL(values.SUPABASE_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(values.SUPABASE_USER_ID)) throw new Error('SUPABASE_USER_ID must be a UUID.');
  return { url: url.origin, secret: values.SUPABASE_SECRET_KEY, ownerId: values.SUPABASE_USER_ID };
}

function authHeaders(config, extra = {}) {
  const headers = { apikey: config.secret, ...extra };
  if (config.secret.startsWith('eyJ')) headers.Authorization = 'Bearer ' + config.secret;
  return headers;
}

async function expectResponse(response, label) {
  if (response.ok) return response;
  const detail = (await response.text()).slice(0, 300);
  throw new Error(label + ' failed with HTTP ' + response.status + (detail ? ': ' + detail : ''));
}

async function uploadImage(config, directory, record, fetchImpl) {
  if (!record.image_file) return null;
  const file = path.join(directory, 'images', record.image_file);
  if (!fs.existsSync(file)) return null;
  const extension = path.extname(file).toLowerCase();
  const contentType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[extension];
  if (!contentType) return null;
  const objectPath = config.ownerId + '/' + record.image_file;
  const response = await fetchImpl(config.url + '/storage/v1/object/listing-images/' + objectPath, {
    method: 'POST',
    headers: authHeaders(config, { 'content-type': contentType, 'x-upsert': 'true' }),
    body: fs.readFileSync(file)
  });
  await expectResponse(response, 'Image upload');
  return objectPath;
}

async function syncToSupabase({ records, run, preferences, directory, env = process.env, fetchImpl = fetch, batchId, preserveExisting = false, syncRules = true }) {
  const config = loadConfig(env);
  if (!config) return { status: 'disabled', listings: 0, images: 0 };

  if (!batchId) {
  const batchResponse = await fetchImpl(config.url + '/rest/v1/collection_batches?select=id', {
    method: 'POST',
    headers: authHeaders(config, { 'content-type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      owner_id: config.ownerId,
      source: 'poshmark_suggested',
      status: ['complete', 'partial', 'needs_attention'].includes(run?.status) ? run.status : 'partial',
      detail: run?.detail ?? '',
      listing_count: records.length,
      started_at: run?.id ?? new Date().toISOString(),
      completed_at: run?.finished_at ?? new Date().toISOString()
    })
  });
  const batch = await (await expectResponse(batchResponse, 'Batch insert')).json();
  batchId = batch[0].id;
  }

  const existing = new Map();
  if (preserveExisting && records.length) {
    const response = await fetchImpl(config.url + '/rest/v1/listings?owner_id=eq.' + config.ownerId + '&poshmark_id=in.(' + records.map(record => record.id).join(',') + ')&select=poshmark_id,first_seen_at,cover_image_path', { headers: authHeaders(config) });
    for (const row of await (await expectResponse(response, 'Existing listing lookup')).json()) existing.set(row.poshmark_id, row);
  }

  let imageCount = 0;
  const imagePaths = new Map();
  for (let index = 0; index < records.length; index += 3) {
    const chunk = records.slice(index, index + 3);
    const paths = await Promise.all(chunk.map(record => {
      const previous = existing.get(record.id)?.cover_image_path;
      if (previous) return previous;
      const upload = uploadImage(config, directory, record, fetchImpl);
      return preserveExisting ? upload.catch(() => null) : upload;
    }));
    paths.forEach((objectPath, offset) => {
      if (objectPath) {
        imagePaths.set(chunk[offset].id, objectPath);
        imageCount++;
      }
    });
  }

  const rows = records.map(record => ({
    owner_id: config.ownerId,
    poshmark_id: record.id,
    title: record.title,
    brand: record.brand,
    asking_price_cents: record.asking_price == null ? null : Math.round(record.asking_price * 100),
    currency: record.currency,
    size: record.size,
    listing_url: record.url,
    cover_image_url: record.cover_image,
    cover_image_path: imagePaths.get(record.id) ?? null,
    availability: record.availability,
    source: record.source,
    source_position: record.source_position,
    last_batch_id: batchId,
    first_seen_at: existing.get(record.id)?.first_seen_at ?? record.first_seen_at,
    last_seen_at: record.last_seen_at
  }));
  const listingsResponse = await fetchImpl(config.url + '/rest/v1/listings?on_conflict=owner_id,poshmark_id', {
    method: 'POST',
    headers: authHeaders(config, { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows)
  });
  await expectResponse(listingsResponse, 'Listing upsert');

  if (syncRules) {
  const rulesResponse = await fetchImpl(config.url + '/rest/v1/filter_rules?on_conflict=owner_id', {
    method: 'POST',
    headers: authHeaders(config, { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{
      owner_id: config.ownerId,
      max_price_cents: Math.round(preferences.max_asking_price_usd * 100),
      blocked_brands: preferences.blocked_brands,
      title_fallback: preferences.title_fallback,
      rule_version: preferences.version,
      updated_at: new Date().toISOString()
    }])
  });
  await expectResponse(rulesResponse, 'Filter rule upsert');
  }
  return { status: 'complete', batchId, listings: rows.length, images: imageCount };
}

module.exports = { loadConfig, syncToSupabase };
