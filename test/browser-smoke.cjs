const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const output = path.join(__dirname, '..', 'output', 'playwright');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  const title = await page.locator('h1').first().innerText();
  const signInVisible = await page.locator('#sign-in-form').isVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: path.join(output, 'signed-out-mobile.png'), fullPage: false });
  console.log(JSON.stringify({ title, signInVisible, horizontalOverflow: overflows, consoleErrors: errors.length }));
  await browser.close();
  if (title !== 'Poshmark picks' || !signInVisible || overflows || errors.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
