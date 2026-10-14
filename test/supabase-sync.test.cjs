const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, syncToSupabase } = require('../lib/supabase-sync.cjs');

const ownerId = '123e4567-e89b-42d3-a456-426614174000';
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_USER_ID: ownerId
};

test('seller imports retain Suggested ordering and write a separate inventory snapshot', async () => {
  const id = 'c'.repeat(24);
  const requests = [];
  const prior = { poshmark_id: id, first_seen_at: '2026-10-01T00:00:00Z', cover_image_path: 'old.jpg', source: 'poshmark_suggested', source_position: 12, last_batch_id: 3, last_seen_at: '2026-10-09T00:00:00Z' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return url.includes('&select=poshmark_id') ? Response.json([prior]) : new Response('', { status: 201 });
  };
  await syncToSupabase({ records: [{ id, title: 'Wool shirt', asking_price: 50, source: 'poshmark_seller', source_position: 0, first_seen_at: '2026-10-14T00:00:00Z', last_seen_at: '2026-10-14T00:00:00Z' }], directory: '.', env, fetchImpl, batchId: 9, preserveExisting: true, syncRules: false, sellerUsername: 'seller' });
  const row = JSON.parse(requests[1].options.body)[0];
  for (const key of ['source', 'source_position', 'last_batch_id', 'last_seen_at']) assert.equal(row[key], prior[key]);
  assert.equal(row.seller_username, 'seller');
  assert.deepEqual(JSON.parse(requests[2].options.body), [{ owner_id: ownerId, batch_id: 9, poshmark_id: id, source_position: 0 }]);
});

test('cloud configuration is optional but rejects partial settings', () => {
  assert.equal(loadConfig({}), null);
  assert.throws(() => loadConfig({ SUPABASE_URL: env.SUPABASE_URL }), /SUPABASE_SECRET_KEY/);
});

test('sync maps the cached listing and rules without exposing the secret', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('collection_batches')) return new Response(JSON.stringify([{ id: 7 }]), { status: 201, headers: { 'content-type': 'application/json' } });
    return new Response('', { status: 201 });
  };
  const result = await syncToSupabase({
    records: [{
      id: 'a'.repeat(24), title: 'Wool sweater', brand: 'Vintage', asking_price: 80,
      currency: 'USD', size: 'M', url: 'https://poshmark.com/listing/example',
      cover_image: null, image_file: null, availability: 'available', source: 'poshmark_suggested',
      source_position: 2, first_seen_at: '2026-10-09T15:00:00.000Z', last_seen_at: '2026-10-09T15:00:00.000Z'
    }],
    run: { id: '2026-10-09T15:00:00.000Z', status: 'complete', detail: 'Complete', finished_at: '2026-10-09T15:01:00.000Z' },
    preferences: { version: 1, max_asking_price_usd: 150, blocked_brands: ['SHEIN'], title_fallback: true },
    directory: '.', env, fetchImpl
  });
  assert.deepEqual(result, { status: 'complete', batchId: 7, listings: 1, images: 0 });
  const listingBody = JSON.parse(requests.find(request => request.url.includes('/listings?')).options.body);
  assert.equal(listingBody[0].asking_price_cents, 8000);
  assert.equal(listingBody[0].owner_id, ownerId);
  assert.equal(JSON.stringify(requests).includes(env.SUPABASE_SECRET_KEY), true);
  assert.equal(JSON.stringify(listingBody).includes(env.SUPABASE_SECRET_KEY), false);
});

test('hosted sync preserves first sighting and cached image without resetting owner rules', async () => {
  const requests = [];
  const id = 'b'.repeat(24);
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('&select=poshmark_id')) return Response.json([{ poshmark_id: id, first_seen_at: '2026-10-01T12:00:00Z', cover_image_path: ownerId + '/existing.jpg' }]);
    return new Response('', { status: 201 });
  };
  await syncToSupabase({ records: [{ id, title: 'Vintage wool sweater', asking_price: 50, source_position: 0, first_seen_at: '2026-10-09T12:00:00Z', last_seen_at: '2026-10-09T12:00:00Z' }], directory: '.', env, fetchImpl, batchId: 8, preserveExisting: true, syncRules: false });
  assert.equal(requests.length, 2);
  const row = JSON.parse(requests[1].options.body)[0];
  assert.equal(row.first_seen_at, '2026-10-01T12:00:00Z');
  assert.equal(row.cover_image_path, ownerId + '/existing.jpg');
  assert.equal(row.last_batch_id, 8);
});
