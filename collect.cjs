const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('./lib/store.cjs');
const { createFilter } = require('./lib/filters.cjs');
const { syncToSupabase } = require('./lib/supabase-sync.cjs');

const TARGET = 200;
const MAX_SCROLLS = 12;
const ENDPOINT = /^\/vm-rest\/users\/[^/]+\/feed\/personalized_v2$/;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only listing posts inside feed units are considered; rendered card IDs decide inclusion.
function feedPosts(data) {
  const posts = [];
  for (const unit of data.data ?? []) {
    for (const item of unit.content?.data ?? []) {
      if (item.post?.id && item.post?.title) posts.push(item.post);
    }
  }
  return posts;
}

async function cacheImage(record, store) {
  const existing = store.list().find(item => item.id === record.id)?.image_file;
  if (existing && fs.existsSync(path.join(store.directory, 'images', existing))) return true;
  try {
    const url = new URL(record.cover_image);
    if (url.protocol !== 'https:' || url.hostname !== 'di2ponv0v5otw.cloudfront.net') return false;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0];
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type];
    if (!response.ok || !extension) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return false;
    const filename = record.id + '.' + extension;
    fs.writeFileSync(path.join(store.directory, 'images', filename), bytes);
    store.setImage(record.id, filename);
    return true;
  } catch { return false; }
}

async function main() {
  const store = openStore();
  const runId = new Date().toISOString();
  const filter = createFilter(JSON.parse(fs.readFileSync(path.join(__dirname, 'preferences.json'), 'utf8')));
  const collected = new Map();
  const posts = new Map();
  let browser;
  let batches = 0;
  let stopReason = '';
  let active = false;
  let parsing = Promise.resolve();
  store.begin(runId);
  fs.mkdirSync(path.join(store.directory, 'images'), { recursive: true });
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.hostname !== 'poshmark.com' || !ENDPOINT.test(url.pathname)) return;
      parsing = parsing.then(async () => {
        if ([401, 403, 429].includes(response.status())) {
          if (active) stopReason = 'Poshmark requires attention (HTTP ' + response.status() + ').';
          return;
        }
        if (!response.ok() || !(response.headers()['content-type'] ?? '').includes('json')) return;
        const data = await response.json();
        for (const post of feedPosts(data)) posts.set(post.id, post);
        batches++;
        console.log(JSON.stringify({ event: 'batch', batches, postsInResponse: feedPosts(data).length }));
      }).catch(() => { stopReason = 'The feed response could not be read. The saved cache is intact.'; });
    });
    await page.goto('https://poshmark.com/feed', { waitUntil: 'domcontentloaded' });
    console.log('SIGN IN in this Chrome window. Collection starts when the feed appears, stops at 200 unique cards or 12 scrolls, then closes this temporary browser.');
    await page.locator('.tile-grid-redesign').first().waitFor({ state: 'attached', timeout: 15 * 60 * 1000 });
    active = true;
    store.status(runId, 'collecting', 'Collecting a bounded batch from your feed.', 0);
    const started = Date.now();
    let idle = 0;
    for (let scroll = 0; scroll <= MAX_SCROLLS; scroll++) {
      await parsing;
      if (new URL(page.url()).pathname !== '/feed') { stopReason = 'The collector left the signed-in feed.'; break; }
      const cards = await page.locator('.tile-grid-redesign').evaluateAll(elements => elements.map(el => ({
        id: el.getAttribute('data-et-prop-listing_id'),
        title: el.querySelector('.tile-grid-redesign__title')?.textContent.trim(),
        url: el.querySelector('a.tile__covershot')?.href,
        image: el.querySelector('img')?.getAttribute('data-src') || el.querySelector('img')?.src,
        asking: el.querySelector('.tile-grid-redesign__price-current')?.textContent.trim(),
        size: el.querySelector('.tile-grid-redesign__size')?.textContent.trim()
      })));
      const before = collected.size;
      for (const card of cards) {
        if (collected.size >= TARGET) break;
        if (!/^[a-f0-9]{24}$/.test(card.id ?? '') || collected.has(card.id) || !card.url?.startsWith('https://poshmark.com/listing/')) continue;
        const post = posts.get(card.id);
        const priceValue = post?.price_amount?.val ?? post?.price;
        const asking = priceValue != null && String(priceValue).trim() !== '' ? Number(priceValue) : /^\$[\d,.]+$/.test(card.asking ?? '') ? Number(card.asking.slice(1).replace(/,/g, '')) : null;
        const record = {
          id: card.id, title: card.title ?? post?.title ?? '', url: card.url,
          brand: typeof post?.brand === 'string' ? post.brand : post?.brand_obj?.canonical_name ?? null,
          asking_price: asking, currency: post?.price_amount?.currency_code ?? (card.asking?.startsWith('$') ? 'USD' : null),
          cover_image: post?.cover_shot?.url ?? card.image ?? null,
          size: card.size ?? post?.size ?? null, availability: post?.inventory?.status ?? null,
          source: 'poshmark_suggested', observed_at: new Date().toISOString(), image_file: null
        };
        collected.set(card.id, record);
        store.put(record, runId, collected.size - 1);
      }
      store.status(runId, 'collecting', 'Collected ' + collected.size + ' unique listings.', collected.size);
      console.log(JSON.stringify({ event: 'progress', collected: collected.size, scroll }));
      idle = collected.size === before ? idle + 1 : 0;
      if (collected.size >= TARGET || stopReason || idle >= 3 || scroll === MAX_SCROLLS || Date.now() - started > 10 * 60 * 1000) break;
      const priorBatches = batches;
      await page.keyboard.press('Control+End');
      for (let attempt = 0; attempt < 30 && batches === priorBatches && !stopReason; attempt++) await delay(300);
      await delay(500);
    }
    await browser.close();
    browser = null;
    const rows = [...collected.values()];
    store.status(runId, 'caching_images', 'Saving cover photos for local browsing.', rows.length);
    let imageCount = 0;
    for (let index = 0; index < rows.length; index += 3) {
      const results = await Promise.all(rows.slice(index, index + 3).map(record => cacheImage(record, store)));
      imageCount += results.filter(Boolean).length;
    }
    const reasons = {};
    for (const record of rows) {
      const result = filter(record);
      const key = result.keep ? 'eligible' : result.reason;
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
    const status = stopReason ? 'needs_attention' : rows.length >= TARGET ? 'complete' : 'partial';
    const detail = stopReason || (status === 'complete' ? 'Collection complete.' : 'Stopped at the collection limit or after the feed stopped yielding new items.');
    store.status(runId, status, detail, rows.length, true);
    let cloud = null;
    if (process.argv.includes('--sync')) {
      try {
        cloud = await syncToSupabase({ records: store.list(), run: store.latestRun(), preferences: JSON.parse(fs.readFileSync(path.join(__dirname, 'preferences.json'), 'utf8')), directory: store.directory });
      } catch (error) {
        cloud = { status: 'failed', detail: error.message };
        process.exitCode = 1;
      }
    }
    console.log(JSON.stringify({ event: 'finished', status, collected: rows.length, batches, cachedImages: imageCount, reasons, detail, cloud }));
  } catch (error) {
    store.status(runId, 'needs_attention', 'Collection stopped: ' + error.message.split('\n')[0], collected.size, true);
    console.error('Collection stopped. Saved listings are intact. ' + error.message.split('\n')[0]);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    store.close();
  }
}
if (require.main === module) main();
module.exports = { feedPosts };
