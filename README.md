# Poshmark companion

A private companion feed for cached Poshmark suggestions. The collector opens the signed-in Suggested for You feed in Chrome and saves a bounded batch. An authenticated mobile PWA applies personal filters and presents a one-photo grid. Each card opens the original Poshmark listing.

The current prototype has two storage layers:

- Local SQLite and cached images retain the collector's source cache.
- Supabase stores the owner-scoped cloud copy and private cover images.
- The PWA reads the Supabase cache through authenticated RLS access.

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
| `npm start` | Run the PWA development server at `http://127.0.0.1:5173` |
| `npm run build` | Build the deployable PWA in `dist` |
| `npm run preview` | Preview the production build |
| `npm run start:local-cache` | Serve the built PWA and local cache API at `http://127.0.0.1:4173` |
| `npm run collect` | Collect up to 200 listings into the local cache |
| `npm run sync` | Upload the existing local cache to Supabase |
| `npm run collect:cloud` | Collect a fresh batch, then sync it to Supabase |
| `npm test` | Run the core and cloud-sync tests |
| `npm run test:browser` | Check the signed-out mobile layout in Chrome while a server is running on port 4173 |
| `npm run test:interface` | Verify UI states and accessibility with five synthetic listings, while the dev server runs on port 5174. Override with `BASE_URL` |

The collector uses a temporary browser context and does not save Poshmark cookies or passwords. It stops after 200 unique listings, 12 scrolls, ten minutes, repeated empty scrolls, or an access response requiring attention.

## Supabase configuration

Copy `.env.example` to `.env.local` and fill in:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=
SUPABASE_USER_ID=your-auth-user-uuid
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example
```

Keep `.env.local` on the collector computer. It is ignored by Git. The secret key must never appear in browser code. The Vite variables contain the project URL and browser-safe publishable key.

Database migrations live in `supabase/migrations`. They create owner-scoped tables for collection batches, listings, listing state, and filter rules, plus a private `listing-images` bucket.

## PWA behavior

The browser signs in with the single Supabase Auth account. It loads up to 1,000 cached listings, applies the current cloud filter rules, and creates one-hour signed URLs for private cover images. The All picks and Saved views work from the cached dataset. Save, hide, viewport view, and outbound open actions write to `user_listing_state`.

Hide offers a persistent Undo action for consecutive hides in the current session. Reloading the page ends that Undo history. Refresh reloads the existing cloud cache; run the collector to gather new Poshmark listings. The interface review and verification record is in [Design review](docs/interface-review.md).

For a production deployment, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel. The collector-only secret variables stay on the collector computer.

## Deployment

Production runs at [poshmark-wrapper.vercel.app](https://poshmark-wrapper.vercel.app). Vercel Authentication protects Preview deployments. Production exposes the static sign-in shell, while Supabase Auth, RLS, and private Storage policies protect listing data and images.

The October 9 interface improvements are deployed from commit `3091e33`. Current verification and remaining phone checks are recorded in [Project status](docs/project-status.md). New listing batches reach the app through `npm run collect:cloud` and Refresh, without a frontend deployment. Browsing the hosted cache requires internet access to Supabase; the collector computer can be offline.

The [cloud-browser probe](docs/cloud-browser-probe.md) verified Poshmark sign-in persistence across two Browserbase sessions. It is a separate feasibility check; the hosted collection job and on-demand app action are still to be built.

## Filtering

`preferences.json` is the current rule source. Listings above $150 are excluded. The configured 53-brand blocklist uses structured brand data when available and title matching as a fallback when brand data is missing. Unknown and vintage labels remain visible. Source order is preserved.

## Repository boundaries

Git excludes Supabase secrets, Poshmark session data, SQLite data, cached images, probe output, screenshots, dependencies, and local project notes.

This project relies on undocumented Poshmark feed behavior and browser automation. Selectors, response fields, pagination, access controls, or account enforcement can change. Poshmark's terms prohibit scraping and automated collection, so collection carries account and access risk.
