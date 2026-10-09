# Poshmark companion

A private companion feed for cached Poshmark suggestions. The collector opens the signed-in Suggested for You feed in Chrome, saves a bounded batch, applies personal filters, and presents a one-photo grid. Each card opens the original Poshmark listing.

The current prototype has two storage layers:

- Local SQLite and cached images keep browsing available on the collector computer.
- Supabase stores an owner-scoped cloud copy for the planned mobile PWA.

See [Project status](docs/project-status.md) for the verified state, architecture, risks, and next milestone. Feed endpoint observations are documented in [Personalized feed probe](feed-findings.md).

## Requirements

- Node.js 24 or newer
- Google Chrome
- A signed-in Poshmark account during collection
- A Supabase project for cloud sync

Install dependencies:

```powershell
npm install
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Serve the saved local feed at `http://127.0.0.1:4173` |
| `npm run collect` | Collect up to 200 listings into the local cache |
| `npm run sync` | Upload the existing local cache to Supabase |
| `npm run collect:cloud` | Collect a fresh batch, then sync it to Supabase |
| `npm test` | Run the core and cloud-sync tests |
| `npm run test:browser` | Render and scroll the local feed in Chrome |

The collector uses a temporary browser context and does not save Poshmark cookies or passwords. It stops after 200 unique listings, 12 scrolls, ten minutes, repeated empty scrolls, or an access response requiring attention.

## Supabase configuration

Copy `.env.example` to `.env.local` and fill in:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=
SUPABASE_USER_ID=your-auth-user-uuid
```

Keep `.env.local` on the collector computer. It is ignored by Git. The secret key must never appear in browser code.

Database migrations live in `supabase/migrations`. They create owner-scoped tables for collection batches, listings, listing state, and filter rules, plus a private `listing-images` bucket.

## Filtering

`preferences.json` is the current rule source. Listings above $150 are excluded. The configured 53-brand blocklist uses structured brand data when available and title matching as a fallback when brand data is missing. Unknown and vintage labels remain visible. Source order is preserved.

## Repository boundaries

Git excludes Supabase secrets, Poshmark session data, SQLite data, cached images, probe output, screenshots, dependencies, and local project notes.

This project relies on undocumented Poshmark feed behavior and browser automation. Selectors, response fields, pagination, access controls, or account enforcement can change. Poshmark's terms prohibit scraping and automated collection, so collection carries account and access risk.
