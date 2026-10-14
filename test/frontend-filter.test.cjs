const test = require('node:test');
const assert = require('node:assert/strict');

test('browser filter preserves the price boundary and title fallback', async () => {
  const { createFilter } = await import('../src/filters.mjs');
  const filter = createFilter({ max_price_cents: 15000, blocked_brands: ['ASOS Design'], title_fallback: true });
  const base = { currency: 'USD', asking_price_cents: 15000, availability: 'available' };

  assert.equal(filter({ ...base, brand: 'J. Crew', title: 'Wool sweater' }), true);
  assert.equal(filter({ ...base, asking_price_cents: 15001, brand: 'J. Crew', title: 'Wool sweater' }), false);
  assert.equal(filter({ ...base, brand: null, title: 'ASOS Design shirt' }), false);
  assert.equal(filter({ ...base, brand: null, title: 'Vintage wool cardigan' }), true);
});

test('browser and local filters exclude slim titles regardless of brand or title fallback', async () => {
  const { createFilter } = await import('../src/filters.mjs');
  const browser = createFilter({ max_price_cents: 15000, blocked_brands: [], title_fallback: false });
  const local = require('../lib/filters.cjs').createFilter({ max_asking_price_usd: 150, blocked_brands: [], title_fallback: false });
  const base = { currency: 'USD', asking_price_cents: 8000, asking_price: 80, brand: 'J. Crew', availability: 'available' };
  for (const title of ['Slim shirt', 'Cotton SLIM-FIT pants', 'Jeans (slim)', 'slim']) {
    assert.equal(browser({ ...base, title }), false, title);
    assert.equal(local({ ...base, title }).keep, false, title);
  }
  for (const title of ['Classic fit shirt', 'Slimane vintage jacket', undefined]) {
    assert.equal(browser({ ...base, title }), true, title);
    assert.equal(local({ ...base, title }).keep, true, title);
  }
});
