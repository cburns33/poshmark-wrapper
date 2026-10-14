const test = require('node:test');
const assert = require('node:assert/strict');

test('seller API validates owner and listing, reuses cache, and refreshes on demand', async () => {
  const ownerId = 'owner';
  const listingId = 'a'.repeat(24);
  let jobs = 0;
  let claims = 0;
  let found = true;
  const filters = [];
  const db = { from(table) {
    const query = {
      select() { return this; }, eq(key, value) { filters.push([table, key, value]); return this; },
      in() { return this; }, gte() { return this; }, order() { return this; }, limit() { return this; },
      async single() { return { data: found ? { owner_id: ownerId, poshmark_id: listingId, seller_username: 'seller' } : null }; },
      async maybeSingle() { return { data: { id: 7 } }; }
    };
    return query;
  } };
  const cloudPath = require.resolve('../lib/cloud-collection.cjs');
  require(cloudPath);
  require.cache[cloudPath].exports = {
    cloudClient: () => ({ config: { ownerId }, db }), authorize: async (_db, _owner, token) => token === 'Bearer owner',
    claimBatch: async (_db, owner, fields) => { assert.equal(owner, ownerId); assert.equal(fields.seed_listing_id, listingId); claims++; return 9; },
    runBatch: async (_db, id, _env, listing) => { assert.equal(id, 9); assert.equal(listing.poshmark_id, listingId); jobs++; }
  };
  const functionsPath = require.resolve('@vercel/functions');
  require(functionsPath);
  require.cache[functionsPath].exports = { waitUntil() {} };
  const handler = require('../api/collect.js');
  async function call(body, authorization = 'Bearer owner') {
    const result = {};
    const res = { setHeader() {}, status(status) { result.status = status; return this; }, json(body) { result.body = body; return result; } };
    return handler({ method: 'POST', headers: { authorization }, body }, res);
  }
  assert.equal((await call({ listingId }, 'Bearer outsider')).status, 401);
  assert.equal((await call({ listingId: 'https://example.test' })).status, 400);
  assert.equal((await call({ listingId: [listingId] })).status, 400);
  found = false;
  assert.equal((await call({ listingId })).status, 404);
  found = true;
  assert.equal((await call({ listingId })).body.batchId, 7);
  assert.equal(jobs, 0);
  assert.equal((await call({ listingId, refresh: true })).status, 202);
  assert.equal(jobs, 1);
  assert.equal(claims, 1);
  assert.ok(filters.some(([table, key, value]) => table === 'listings' && key === 'owner_id' && value === ownerId));
});
