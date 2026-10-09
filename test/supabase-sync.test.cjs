const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, syncToSupabase } = require('../lib/supabase-sync.cjs');

const ownerId = '123e4567-e89b-42d3-a456-426614174000';
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_USER_ID: ownerId
};

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
