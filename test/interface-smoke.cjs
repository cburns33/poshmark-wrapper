const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const axe = require('axe-core');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5174';
const output = path.join(__dirname, '..', 'output', 'playwright');
const owner = '00000000-0000-4000-8000-000000000001';
const listings = [
  { poshmark_id: 'one', title: 'Vintage wool cable knit sweater with a shawl collar and wooden buttons', brand: 'Unfamiliar vintage knitwear label', asking_price_cents: 4500, cover_image_path: 'one.jpg' },
  { poshmark_id: 'two', title: 'Linen shirt', brand: 'J.Crew', asking_price_cents: 15000, cover_image_path: 'two.jpg' },
  { poshmark_id: 'three', title: 'Cotton cardigan with a very long unbroken reference ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', brand: null, asking_price_cents: 1900, cover_image_path: null },
  { poshmark_id: 'four', title: 'Blocked item', brand: 'SHEIN', asking_price_cents: 1000 },
  { poshmark_id: 'five', title: 'Over budget', brand: 'J.Crew', asking_price_cents: 15001 },
].map((item, index) => ({ ...item, owner_id: owner, currency: 'USD', availability: 'available', listing_url: `https://poshmark.com/listing/${item.poshmark_id}`, source_position: index, last_seen_at: '2026-10-09T12:00:00Z' }));

async function audit(page, name) {
  await page.evaluate(axe.source);
  const results = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
  return { name, violations: results.violations.map(item => ({ id: item.id, impact: item.impact, count: item.nodes.length, sample: item.nodes[0].target })) };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    let mode = 'normal';
    let failWrite = false;
    let releaseLoad;
    const state = new Map();
    const publicUrl = new URL(process.env.VITE_SUPABASE_URL);
    await context.route(`${publicUrl.origin}/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/')) {
        if (url.pathname.endsWith('/token')) return reply({ error_code: 'invalid_credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
        if (url.pathname.endsWith('/logout')) return reply({});
        return reply({ id: owner, email: 'design@example.test' });
      }
      if (url.pathname.includes('/storage/v1/object/sign/listing-images')) {
        if (request.method() === 'POST') {
          return reply(request.postDataJSON().paths.map(p => ({ path: p, signedURL: `/object/sign/listing-images/${p}?token=fixture` })));
        }
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#ede9e2"/><path d="M100 90L55 115L25 185L65 205L85 155L85 310L215 310L215 155L235 205L275 185L245 115L200 90Q150 130 100 90Z" fill="#858e7a"/></svg>' });
      }
      const table = url.pathname.split('/').pop();
      if (request.method() === 'POST' && table === 'user_listing_state') {
        if (failWrite) return reply({ message: 'Fixture write failure' }, 503);
        const body = request.postDataJSON();
        for (const row of Array.isArray(body) ? body : [body]) state.set(row.poshmark_id, { ...state.get(row.poshmark_id), ...row });
        return reply(null, 201);
      }
      if (table === 'listings') {
        if (mode === 'loading') await new Promise(resolve => { releaseLoad = resolve; });
        if (mode === 'error') return reply({ message: 'Fixture load failure' }, 503);
        return reply(mode === 'empty' ? [] : listings);
      }
      if (table === 'filter_rules') return reply({ max_price_cents: 15000, blocked_brands: ['SHEIN'], title_fallback: true });
      if (table === 'user_listing_state') return reply([...state.values()]);
      if (table === 'collection_batches') return reply({ listing_count: 5, completed_at: '2026-10-09T12:00:00Z' });
      throw new Error(`Unexpected fixture request: ${table}`);
    });
    await page.addInitScript(({ origin, ownerId }) => {
      localStorage.setItem(`sb-${new URL(origin).hostname.split('.')[0]}-auth-token`, JSON.stringify({
        access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: ownerId, email: 'design@example.test' },
      }));
    }, { origin: publicUrl.origin, ownerId: owner });
    await page.goto(baseUrl);
    await page.locator('.card').nth(2).waitFor();
    await page.locator('#reload[aria-disabled="false"]').waitFor();
    const audits = [await audit(page, 'feed')];
    await page.screenshot({ path: path.join(output, 'interface-mobile.png') });
    if (process.argv.includes('--baseline')) {
      console.log(JSON.stringify({ audits, controls: await page.locator('.card-action').first().evaluate(e => ({ height: e.getBoundingClientRect().height })), pageErrors }));
      return;
    }
    assert.equal(await page.locator('.card').count(), 3, 'Filters retain inclusive $150 cap and unfamiliar brands');
    const save = page.locator('[data-id="one"] [data-action="save"]');
    await save.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-id="one"] [data-action="save"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await save.evaluate(e => e === document.activeElement), true, 'Save preserves keyboard focus');
    assert.ok(state.get('one').saved_at, 'Save writes state');
    assert.equal(await page.locator('#summary').innerText().then(t => t.startsWith('3 picks')), true);
    await page.locator('[data-view="saved"]').click();
    assert.equal(await page.locator('.card').count(), 1);
    await save.press('Space');
    await page.locator('#empty').waitFor();
    assert.equal(await page.locator('[data-view="saved"]').evaluate(e => e === document.activeElement), true, 'Removing the last saved card restores view focus');
    await page.locator('#empty-action').click();
    assert.equal(await page.locator('.card').count(), 3);
    await page.locator('[data-id="one"] [data-action="hide"]').press('Enter');
    await page.locator('#undo-hide').waitFor();
    assert.equal(await page.locator('.card').count(), 2);
    assert.equal(await page.locator('[data-id="two"] [data-action="hide"]').evaluate(e => e === document.activeElement), true, 'Hide continues at the next card');
    await page.locator('[data-id="two"] [data-action="hide"]').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
    assert.ok(state.get('one').hidden_at && state.get('two').hidden_at);
    failWrite = true;
    await page.locator('#undo-hide').click();
    await page.waitForFunction(() => document.querySelector('#undo-message').textContent.startsWith('Restore failed'));
    assert.equal(await page.locator('.card').count(), 1, 'Failed Undo leaves the card hidden and recovery available');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Undo error survives narrow width and 200% text size');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 390, height: 844 });
    audits.push(await audit(page, 'undo-error'));
    failWrite = false;
    await page.locator('#undo-hide').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
    await page.locator('#undo-hide').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 3);
    assert.equal(state.get('one').hidden_at, null);
    assert.equal(state.get('two').hidden_at, null);
    assert.equal(await save.evaluate(e => e === document.activeElement), true, 'Undo returns focus to restored card');
    failWrite = true;
    await save.click();
    await page.locator('#listing-error-one').waitFor();
    assert.match(await page.locator('#listing-error-one').innerText(), /try Save again/);
    assert.equal(await save.getAttribute('aria-pressed'), 'false', 'Failed write leaves save state intact');
    failWrite = false;
    mode = 'loading';
    await page.locator('#reload').click();
    await page.waitForFunction(() => document.querySelector('#grid').getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#loading').isVisible(), true);
    assert.equal(await page.locator('#reload').evaluate(e => e === document.activeElement), true, 'Refresh preserves pending focus');
    while (!releaseLoad) await new Promise(resolve => setTimeout(resolve, 20));
    mode = 'error';
    releaseLoad();
    await page.locator('#feed-error').waitFor();
    assert.match(await page.locator('#feed-error').innerText(), /Try again/);
    assert.equal(await page.locator('#empty').isVisible(), false, 'Failure does not show empty-feed message');
    mode = 'normal';
    await page.locator('#retry-feed').click();
    await page.locator('#feed-error').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#reload').evaluate(e => e === document.activeElement), true, 'Retry returns focus to Refresh');
    mode = 'empty';
    await page.locator('#reload').click();
    await page.locator('#empty').waitFor();
    assert.match(await page.locator('#empty').innerText(), /collector/);
    audits.push(await audit(page, 'empty'));
    mode = 'normal';
    await page.locator('#reload').click();
    await page.locator('.card').nth(2).waitFor();
    const widths = [320, 390, 540, 760, 1100, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '200% text resizing reflows');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.dir = 'rtl'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'RTL reflows');
    await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await save.press('Tab');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true, 'Focus survives forced colors');
    await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    audits.push(await audit(page, 'feed-final'));
    await page.locator('#sign-out').click();
    await page.locator('#sign-in-form').waitFor();
    await page.locator('#email').fill('design@example.test');
    await page.locator('#password').fill('wrong-fixture-password');
    await page.locator('#password').press('Enter');
    await page.locator('#auth-error').waitFor();
    assert.match(await page.locator('#auth-error').innerText(), /Check your email and password/);
    assert.equal(await page.locator('#email').evaluate(e => e === document.activeElement), true);
    assert.equal(await page.locator('#email').getAttribute('aria-invalid'), 'true');
    audits.push(await audit(page, 'sign-in-error'));
    await page.screenshot({ path: path.join(output, 'interface-sign-in.png') });
    assert.equal(pageErrors.length, 0, 'No unhandled browser errors');
    for (const result of audits) assert.equal(result.violations.length, 0, `${result.name}: ${JSON.stringify(result.violations)}`);
    console.log(JSON.stringify({ passed: true, checks: 'filters, Save focus, Saved empty exit, Hide focus, multiple Undo, write failure, loading, refresh failure and retry, empty feed, six widths, 200% text resize, RTL, forced colors, sign-in error', axeViolations: 0, pageErrors: 0 }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
