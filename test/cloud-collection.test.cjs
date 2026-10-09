const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize, claimBatch } = require('../lib/cloud-collection.cjs');

test('collection accepts only a validated owner token', async () => {
  const db = { auth: { getUser: async token => ({ data: { user: { id: token } }, error: null }) } };
  assert.equal(await authorize(db, 'owner', ''), false);
  assert.equal(await authorize(db, 'owner', 'Bearer someone-else'), false);
  assert.equal(await authorize(db, 'owner', 'Bearer owner'), true);
  db.auth.getUser = async () => ({ data: { user: null }, error: new Error('Expired') });
  assert.equal(await authorize(db, 'owner', 'Bearer owner'), false);
});

test('a duplicate active batch does not start a second collection', async () => {
  let insertResult = { data: { id: 2 }, error: null };
  const db = { from: () => ({
    update: () => ({ eq: () => ({ eq: () => ({ lt: async () => ({ error: null }) }) }) }),
    insert: () => ({ select: () => ({ single: async () => insertResult }) }),
  }) };
  assert.equal(await claimBatch(db, 'owner'), 2);
  insertResult = { data: null, error: { code: '23505' } };
  assert.equal(await claimBatch(db, 'owner'), null);
  insertResult = { data: null, error: new Error('Unavailable') };
  await assert.rejects(claimBatch(db, 'owner'), /Unavailable/);
});
