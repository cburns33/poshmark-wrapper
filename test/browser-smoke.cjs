const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const output = path.join(__dirname, '..', 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const external = [];
  page.on('request', request => {
    const host = new URL(request.url()).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) external.push(request.url());
  });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  const cards = await page.locator('.card').count();
  const summary = await page.locator('#summary').innerText();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, 'feed.png'), fullPage: false });
  console.log(JSON.stringify({ cards, summary, externalRequests: external.length, screenshot: path.join(output, 'feed.png') }));
  await browser.close();
  if (cards === 0 || external.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
