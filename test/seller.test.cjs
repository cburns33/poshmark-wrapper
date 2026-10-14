const test = require('node:test');
const assert = require('node:assert/strict');
const { filteredSellerRequest, sellerRecord } = require('../lib/seller-collector.cjs');

test('seller collection accepts only the selected seller, Men, saved sizes, and available inventory', () => {
  const url = request => new URL('https://poshmark.com/vm-rest/users/seller/posts/filtered?request=' + encodeURIComponent(JSON.stringify(request)));
  const filters = { department: 'Men', size: { my_size_v3: true }, inventory_status: ['available'] };
  assert.equal(filteredSellerRequest(url({ filters }), 'seller'), true);
  assert.equal(filteredSellerRequest(url({ filters }), 'other'), false);
  for (const override of [{ department: 'All' }, { size: {} }, { inventory_status: ['sold_out'] }]) assert.equal(filteredSellerRequest(url({ filters: { ...filters, ...override } }), 'seller'), false);
});

test('seller inventory excludes other departments and unwanted categories and retains explicit size', () => {
  const post = { id: 'a'.repeat(24), creator_username: 'seller', department: { display: 'Men' }, category: 'Pants', title: 'Linen trousers', size: '36x32', size_obj: { display: '36 × 32' }, price_amount: { val: '45', currency_code: 'USD' }, inventory: { status: 'available' } };
  assert.equal(sellerRecord(post, 'seller').size, '36 × 32');
  assert.equal(sellerRecord(post, 'seller').asking_price, 45);
  assert.equal(sellerRecord({ ...post, creator_username: 'other' }, 'seller'), null);
  assert.equal(sellerRecord({ ...post, department: { display: 'Women' } }, 'seller'), null);
  for (const category of ['Shoes', 'Accessories', 'Suits & Blazers']) assert.equal(sellerRecord({ ...post, category }, 'seller'), null);
});
