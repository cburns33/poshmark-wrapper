const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openStore(directory = path.join(__dirname, '..', 'data')) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'cache.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY, payload TEXT NOT NULL, first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL, run_id TEXT NOT NULL, position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT NOT NULL,
      finished_at TEXT, count INTEGER NOT NULL DEFAULT 0
    );`);
  return {
    directory,
    begin(id) { db.prepare('INSERT INTO runs(id,status,detail) VALUES(?,?,?)').run(id, 'waiting_for_login', 'Sign in in the collector browser.'); },
    status(id, status, detail, count, finished = false) {
      db.prepare('UPDATE runs SET status=?,detail=?,count=?,finished_at=? WHERE id=?').run(status, detail, count, finished ? new Date().toISOString() : null, id);
    },
    put(record, runId, position) {
      const now = new Date().toISOString();
      const old = db.prepare('SELECT payload FROM listings WHERE id=?').get(record.id);
      const previous = old ? JSON.parse(old.payload) : null;
      if (previous && previous.cover_image === record.cover_image && previous.image_file) record.image_file = previous.image_file;
      db.prepare(`INSERT INTO listings VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        payload=excluded.payload,last_seen=excluded.last_seen,run_id=excluded.run_id,position=excluded.position`)
        .run(record.id, JSON.stringify(record), now, now, runId, position);
    },
    setImage(id, imageFile) {
      const row = db.prepare('SELECT payload FROM listings WHERE id=?').get(id);
      if (row) db.prepare('UPDATE listings SET payload=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.payload), image_file: imageFile }), id);
    },
    list() {
      return db.prepare('SELECT * FROM listings ORDER BY run_id DESC,position ASC').all().map(row => ({ ...JSON.parse(row.payload), first_seen_at: row.first_seen, last_seen_at: row.last_seen, source_position: row.position }));
    },
    latestRun() { return db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() ?? null; },
    close() { db.close(); }
  };
}
module.exports = { openStore };
