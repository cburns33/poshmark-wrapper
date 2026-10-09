const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const statePath = path.join(__dirname, 'probe-output', 'browserbase-context.json');
const mode = process.argv[2];

async function main() {
  if (!['login', 'verify'].includes(mode)) throw new Error('Use: node --env-file=.env.local cloud-probe.cjs login|verify');
  if (!process.env.BROWSERBASE_API_KEY) throw new Error('BROWSERBASE_API_KEY is missing.');

  const { default: Browserbase } = await import('@browserbasehq/sdk');
  const client = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
  let contextId;
  if (mode === 'login') {
    if (fs.existsSync(statePath)) {
      contextId = JSON.parse(fs.readFileSync(statePath, 'utf8')).contextId;
    } else {
      const context = await client.contexts.create({ name: 'poshmark-companion-probe' });
      contextId = context.id;
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify({ contextId }), { mode: 0o600 });
    }
  } else {
    contextId = JSON.parse(fs.readFileSync(statePath, 'utf8')).contextId;
  }

  const session = await client.sessions.create({
    browserSettings: { context: { id: contextId, persist: true } },
    api_timeout: mode === 'login' ? 840 : 180
  });
  console.log(JSON.stringify({ event: 'session', mode, id: session.id }));

  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
    await page.goto('https://poshmark.com/feed', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const deadline = Date.now() + (mode === 'login' ? 10 * 60_000 : 60_000);
    let lastStatus = '';
    while (Date.now() < deadline) {
      const cards = await page.locator('.tile-grid-redesign').count();
      const status = new URL(page.url()).pathname;
      if (cards > 0) {
        console.log(JSON.stringify({ event: 'authenticated_feed', mode, cards }));
        return;
      }
      if (status !== lastStatus) {
        console.log(JSON.stringify({ event: 'waiting_for_feed', mode, path: status }));
        lastStatus = status;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(mode === 'login' ? 'Sign-in did not reach the Suggested feed within ten minutes.' : 'Saved session did not reach the Suggested feed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  const message = String(error.message ?? error).replaceAll(process.env.BROWSERBASE_API_KEY || 'BROWSERBASE_API_KEY', '[redacted]');
  console.error(message);
  process.exitCode = 1;
});
