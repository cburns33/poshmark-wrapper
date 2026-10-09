const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('./lib/store.cjs');
const { createFilter } = require('./lib/filters.cjs');

function createServer(store = openStore()) {
  return http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://umubcxkoxvzxucpwrwmm.supabase.co; connect-src 'self' https://umubcxkoxvzxucpwrwmm.supabase.co; base-uri 'none'; frame-ancestors 'none'");
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    try {
      if (pathname === '/api/feed') {
        const preferences = JSON.parse(fs.readFileSync(path.join(__dirname, 'preferences.json'), 'utf8'));
        const filter = createFilter(preferences);
        const rows = store.list();
        const eligible = [];
        const excluded = {};
        for (const row of rows) {
          const result = filter(row);
          if (result.keep) eligible.push({
            id: row.id, title: row.title, brand: row.brand, price: row.asking_price, size: row.size,
            url: row.url, image: row.image_file ? '/images/' + row.image_file : null,
            observed_at: row.last_seen_at
          });
          else excluded[result.reason] = (excluded[result.reason] ?? 0) + 1;
        }
        const body = JSON.stringify({
          listings: eligible,
          filters: { max_price: preferences.max_asking_price_usd, blocked_brands: preferences.blocked_brands.length, title_fallback: preferences.title_fallback },
          summary: { collected: rows.length, eligible: eligible.length, cached_images: eligible.filter(row => row.image).length, excluded },
          run: store.latestRun()
        });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : body);
        return;
      }
      let filename;
      let type;
      if (/^\/images\/[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(pathname)) {
        filename = path.join(store.directory, 'images', path.basename(pathname));
        type = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(filename)];
      } else {
        const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
        filename = path.resolve(__dirname, 'dist', relative);
        const staticRoot = path.resolve(__dirname, 'dist') + path.sep;
        if (!filename.startsWith(staticRoot)) { response.writeHead(404).end(); return; }
        type = {
          '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'
        }[path.extname(filename)] || 'application/octet-stream';
      }
      if (!fs.existsSync(filename)) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': pathname.startsWith('/images/') ? 'private, max-age=3600' : 'no-cache' });
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(filename).pipe(response);
    } catch (error) {
      console.error('Request failed:', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unable to load the saved feed. Check the local server terminal.' }));
    }
  });
}
if (require.main === module) {
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(4173, '127.0.0.1', () => console.log('Your saved feed: http://127.0.0.1:4173'));
}
module.exports = { createServer };
