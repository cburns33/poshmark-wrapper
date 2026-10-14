const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('./store.cjs');
const { cacheImage } = require('../collect.cjs');
const { syncToSupabase } = require('./supabase-sync.cjs');

function filteredSellerRequest(url, username) {
  if (url.hostname !== 'poshmark.com' || url.pathname !== `/vm-rest/users/${username}/posts/filtered`) return false;
  try {
    const request = JSON.parse(url.searchParams.get('request'));
    return request.filters?.department === 'Men' && request.filters?.size?.my_size_v3 === true && request.filters?.inventory_status?.includes('available');
  } catch { return false; }
}

function sellerRecord(post, username) {
  if (!/^[a-f0-9]{24}$/.test(post.id || '') || post.creator_username !== username || post.department?.display !== 'Men') return null;
  const category = String(post.category || '').toLowerCase();
  if (/shoes|accessories|suits/.test(category)) return null;
  return {
    id: post.id, title: post.title || '', brand: post.brand_obj?.canonical_name || post.brand || null,
    asking_price: Number(post.price_amount?.val ?? post.price), currency: post.price_amount?.currency_code,
    size: post.size_obj?.display || post.size, availability: post.inventory?.status,
    url: `https://poshmark.com/listing/${post.id}`, cover_image: post.cover_shot?.url,
    seller_username: username, source: 'poshmark_seller', image_file: null
  };
}

async function collectSeller({ connectUrl, directory, batchId, listing, db }) {
  const deadline = Date.now() + 230000;
  const store = openStore(directory);
  const runId = new Date().toISOString();
  store.begin(runId);
  fs.mkdirSync(path.join(directory, 'images'), { recursive: true });
  let browser;
  try {
    browser = await chromium.connectOverCDP(connectUrl, { timeout: 30000 });
    const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
    let username = listing.seller_username;
    if (!username) {
      const listingUrl = new URL(listing.listing_url);
      if (listingUrl.origin !== 'https://poshmark.com' || !listingUrl.pathname.startsWith('/listing/')) throw new Error('Invalid Poshmark listing URL.');
      await page.goto(listing.listing_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Seller identity comes from the listing's own content, excluding the header navigation.
      const seller = page.locator('a[data-et-name="seller"][data-et-prop-location="closet_widget"][href^="/closet/"]').first();
      await seller.waitFor({ state: 'attached', timeout: 15000 });
      username = /^\/closet\/([a-zA-Z0-9_]+)$/.exec(await seller.getAttribute('href'))?.[1];
    }
    if (!/^[a-zA-Z0-9_]{1,80}$/.test(username || '')) throw new Error('Seller could not be identified from this listing.');
    const { error } = await db.from('collection_batches').update({ seller_username: username }).eq('id', batchId);
    if (error) throw error;
    const { error: identityError } = await db.from('listings').update({ seller_username: username }).eq('owner_id', listing.owner_id).eq('poshmark_id', listing.poshmark_id);
    if (identityError) throw identityError;
    const posts = new Map();
    let parsing = Promise.resolve();
    let responses = 0;
    let total;
    let next;
    let failure;
    page.on('response', response => {
      const url = new URL(response.url());
      if (!filteredSellerRequest(url, username)) return;
      parsing = parsing.then(async () => {
        if (!response.ok()) throw new Error('The filtered seller inventory could not be loaded.');
        const data = await response.json();
        responses++;
        for (const post of (data.data || []).slice(0, 200)) if (posts.size < 200) posts.set(post.id, post);
        total = data.more?.total;
        next = data.more?.is_next_max_id_present;
      }).catch(error => { failure = error; });
    });
    await page.goto(`https://poshmark.com/closet/${username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const sizes = page.getByText('My Size', { exact: true });
    await sizes.waitFor({ timeout: 15000 });
    const sizeInput = sizes.locator('input');
    if (!await sizeInput.isChecked()) await sizes.click({ timeout: 5000 });
    const men = page.locator('a[data-et-prop-location="filter"][data-et-name="department"][data-et-prop-content="Men"]');
    await men.click({ timeout: 5000 });
    const started = Date.now();
    for (let attempt = 0; attempt < 40 && !responses && !failure; attempt++) await page.waitForTimeout(250);
    await parsing;
    if (failure) throw failure;
    if (!responses) throw new Error('Men and My Sizes could not be verified. No seller items were imported.');
    let idle = 0;
    for (let scroll = 0; scroll < 12 && Date.now() - started < 60000; scroll++) {
      await parsing;
      if (failure) throw failure;
      if (posts.size >= 200 || total === 0 || next === false || posts.size >= total) break;
      const before = posts.size;
      await page.keyboard.press('Control+End');
      await page.waitForTimeout(1500);
      await parsing;
      idle = posts.size === before ? idle + 1 : 0;
      if (idle >= 3) break;
    }
    await parsing;
    if (failure) throw failure;
    const rows = [...posts.values()].map(post => sellerRecord(post, username)).filter(Boolean);
    rows.forEach((record, index) => store.put(record, runId, index));
    await browser.close();
    browser = null;
    for (let index = 0; index < rows.length && Date.now() < deadline - 60000; index += 6) {
      await Promise.all(rows.slice(index, index + 6).map(record => cacheImage(record, store)));
    }
    const complete = next === false || total === 0 || posts.size >= total;
    const status = complete ? 'complete' : 'partial';
    const detail = complete ? 'Seller collection complete. Men and My Sizes applied.' : 'Collected a bounded seller batch. Men and My Sizes applied.';
    store.status(runId, status, detail, rows.length, true);
    // Empty inventory is a successful snapshot, with no listing upsert required.
    const cloud = rows.length ? await syncToSupabase({ records: store.list(), directory, batchId, preserveExisting: true, syncRules: false, sellerUsername: username,
      fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))) }) }) : { images: 0 };
    return { status, detail, collected: rows.length, cloud };
  } finally {
    if (browser) await browser.close().catch(() => {});
    store.close();
  }
}
module.exports = { collectSeller, filteredSellerRequest, sellerRecord };
