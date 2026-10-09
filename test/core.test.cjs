const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createFilter } = require('../lib/filters.cjs');
const { openStore } = require('../lib/store.cjs');
const { createServer } = require('../server.cjs');

const preferences = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'preferences.json'), 'utf8'));
const filter = createFilter(preferences);
const listing = overrides => ({ id: 'a'.repeat(24), title: 'Vintage wool sweater', brand: 'Unknown Label', asking_price: 80, currency: 'USD', availability: 'available', ...overrides });

test('filter keeps the inclusive price boundary and rejects values above it', () => {
  assert.equal(filter(listing({ asking_price: 150 })).keep, true);
  assert.deepEqual(filter(listing({ asking_price: 150.01 })), { keep: false, reason: 'over_budget' });
});

test('factory brands are distinct from their kept mainline brands', () => {
  assert.equal(filter(listing({ brand: 'J. Crew' })).keep, true);
  assert.equal(filter(listing({ brand: 'J. Crew Factory' })).reason, 'blocked_brand');
  assert.equal(filter(listing({ brand: 'Banana Republic' })).keep, true);
  assert.equal(filter(listing({ brand: 'Banana Republic Factory' })).reason, 'blocked_brand');
});

test('missing brands use the authorized title fallback', () => {
  assert.equal(filter(listing({ brand: null, title: 'Old Navy cotton sweater' })).reason, 'blocked_title');
  assert.equal(filter(listing({ brand: null, title: 'Obscure vintage knitwear' })).keep, true);
});

test('cache deduplicates IDs and API returns only eligible records', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posh-cache-'));
  const store = openStore(directory);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const runId = new Date().toISOString();
  store.begin(runId);
  store.put(listing({ title: 'First observation' }), runId, 0);
  store.put(listing({ title: 'Latest observation' }), runId, 1);
  store.put(listing({ id: 'b'.repeat(24), brand: 'SHEIN', title: 'Blocked' }), runId, 2);
  store.status(runId, 'complete', 'Complete', 2, true);
  assert.equal(store.list().length, 2);
  assert.equal(store.list().find(row => row.id === 'a'.repeat(24)).title, 'Latest observation');

  const server = createServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/feed`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.summary.collected, 2);
  assert.equal(body.summary.eligible, 1);
  assert.equal(body.listings[0].title, 'Latest observation');
  assert.equal(body.summary.excluded.blocked_brand, 1);
});
