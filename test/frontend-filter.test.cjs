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
