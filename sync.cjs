const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('./lib/store.cjs');
const { syncToSupabase } = require('./lib/supabase-sync.cjs');

async function main() {
  const store = openStore();
  try {
    const result = await syncToSupabase({
      records: store.list(),
      run: store.latestRun(),
      preferences: JSON.parse(fs.readFileSync(path.join(__dirname, 'preferences.json'), 'utf8')),
      directory: store.directory
    });
    console.log(JSON.stringify(result));
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
