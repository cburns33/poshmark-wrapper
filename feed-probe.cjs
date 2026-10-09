// Run with Node and Playwright available through NODE_PATH.
// This probe keeps authentication in a temporary browser context.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  let inspectNext = true;
  let observed = 0;
  const output = path.join(__dirname, 'probe-output');
  fs.mkdirSync(output, { recursive: true });

  page.on('response', async response => {
    const url = new URL(response.url());
    const resource = response.request().resourceType();
    if (url.hostname !== 'poshmark.com' || !['xhr', 'fetch'].includes(resource)) return;
    if (!/feed|posts/i.test(url.pathname)) return;
    const endpoint = url.pathname.replace(/\/users\/[^/]+\//, '/users/{userId}/');
    if (observed++ < 5) console.log(JSON.stringify({ event: 'feed-response', path: endpoint, status: response.status() }));
    if (!inspectNext || !response.ok() || !(response.headers()['content-type'] || '').includes('json')) return;
    inspectNext = false;
    try {
      const data = await response.json();
      const records = [];
      const paginationPaths = [];
      function visit(value, location) {
        if (!value || typeof value !== 'object') return;
        if (!Array.isArray(value) && value.id && typeof value.title === 'string' && ('price' in value || 'price_amount' in value)) {
          records.push({
            id: value.id, title: value.title,
            brand: typeof value.brand === 'string' ? value.brand : value.brand_obj?.canonical_name ?? null,
            asking_price: value.price_amount?.val ?? value.price ?? null,
            currency: value.price_amount?.currency_code ?? null,
            cover_image: value.cover_shot?.url ?? null,
            source_path: location
          });
        }
        for (const [key, child] of Object.entries(value)) {
          if (/^(next_max_id|max_id|cursor|next_cursor|has_more)$/.test(key) && paginationPaths.length < 5) paginationPaths.push(location + '.' + key);
          visit(child, location + '.' + key);
        }
      }
      visit(data, '$');
      const unique = [...new Map(records.map(record => [record.id, record])).values()];
      const report = {
        captured_at: new Date().toISOString(), endpoint_path: endpoint,
        top_level_keys: Object.keys(data).slice(0, 5),
        unique_listing_count: unique.length,
        with_brand: unique.filter(record => record.brand).length,
        pagination_paths: paginationPaths,
        sample: unique.slice(0, 5)
      };
      fs.writeFileSync(path.join(output, 'response-summary.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ event: 'inspection-complete', ...report }));
    } catch (error) {
      console.log(JSON.stringify({ event: 'inspection-error', message: error.message }));
    }
  });

  await page.goto('https://poshmark.com/feed', { waitUntil: 'domcontentloaded' });
  console.log('READY: Sign in in the Chrome window. The next successful feed JSON response will be inspected once. Optional commands: status, inspect, screenshot, quit.');
  const input = readline.createInterface({ input: process.stdin });
  for await (const command of input) {
    try {
      if (command.trim() === 'status') {
        console.log(JSON.stringify({ event: 'status', path: new URL(page.url()).pathname, feed_cards: await page.locator('.tile-grid-redesign').count() }));
      } else if (command.trim() === 'inspect') {
        if (new URL(page.url()).pathname !== '/feed') {
          console.log('Sign in and open /feed first.');
          continue;
        }
        inspectNext = true;
        await page.keyboard.press('Control+End');
        console.log('Armed for one feed JSON response; scrolled to load the next batch.');
      } else if (command.trim() === 'screenshot') {
        await page.screenshot({ path: path.join(output, 'browser.png') });
        console.log('Saved probe-output/browser.png');
      } else if (command.trim() === 'quit') {
        await browser.close();
        input.close();
        break;
      }
    } catch (error) {
      console.log(JSON.stringify({ event: 'command-error', message: error.message }));
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
