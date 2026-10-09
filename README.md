# Poshmark companion prototype

This local prototype collects a bounded batch from the signed-in Poshmark Suggested for You feed, stores listing metadata and cover photos, applies `preferences.json`, and serves a private photo grid. Tapping a photo opens the original Poshmark listing.

It requires Node.js 24 or newer and Google Chrome. Install the dependency once:

```powershell
npm install
```

## Browse the saved feed

From PowerShell:

```powershell
npm start
```

Then open `http://127.0.0.1:4173`. The server binds only to the local computer.

## Refresh the cache

Open another PowerShell window:

```powershell
npm run collect
```

Sign in in the temporary Chrome window. Collection starts when the feed appears. The browser closes after the bounded run. Existing cached listings remain available if collection stops early.

The collector does not save Poshmark cookies or passwords. It currently aims for 200 unique listings and stops after 12 scrolls, ten minutes, repeated empty scrolls, or an access response requiring attention.

## Verify core behavior

```powershell
npm test
```

The tests cover the inclusive $150 limit, factory/mainline brand distinctions, title fallback, deduplication, and filtering through the local API.

## Privacy and deployment

The SQLite database, cached images, probe output, screenshots, and local project state are ignored by Git. The app binds to `127.0.0.1`, so it is available only on the computer running it.

The current collector and cache are designed for a local computer. A hosted deployment needs a separate authenticated collector and durable hosted storage.

## Supabase

The initial cloud schema is in `supabase/migrations/20261009_initial_schema.sql`. It creates private, owner-scoped tables for collection batches, listings, listing state, and filter rules, plus a private `listing-images` bucket. Copy `.env.example` to `.env.local` when cloud sync is enabled. Keep `SUPABASE_SECRET_KEY` on the collector computer and never place it in browser code.
