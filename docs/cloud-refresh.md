# On-demand cloud collection

Implemented and tested October 9, 2026. In the signed-in app, Get new picks starts a hosted collection. Refresh reloads the existing cache. Collection continues on Vercel and Browserbase after the app request returns, using `waitUntil`; the PC does not run the hosted controller.

## Flow

1. The PWA sends its Supabase access token to `POST /api/collect`.
2. The server validates the token with Supabase Auth and checks the configured owner UUID.
3. It claims a `collecting` batch. A database unique index prevents a second active run for that owner.
4. Vercel connects Playwright to Browserbase's saved Poshmark Context. The existing collector reads normal Suggested feed responses and rendered cards, stopping at 200 listings or its scroll and time limits.
5. A temporary SQLite cache and cover photos support the existing Supabase sync. Existing first-seen timestamps and cached photo paths are preserved. Cloud collection does not overwrite the owner's cloud filter rules. Each remote batch uses one last-seen timestamp so source order holds within the batch.
6. The batch records completion or failure. The PWA checks running status every five seconds and reloads the feed on completion.

## Server configuration

Production-only Vercel variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_USER_ID`, `BROWSERBASE_API_KEY`, and `BROWSERBASE_CONTEXT_ID`. They are configured. None uses a Vite prefix. Frontend configuration remains `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

The saved Context ID is also in ignored `probe-output/browserbase-context.json`. To restore an expired Poshmark login in that same Context, run `node --env-file=.env.local cloud-probe.cjs login`, open the printed Browserbase session, and sign in through Live View. A replacement Context requires updating the production Context variable and redeploying.

The function has a 300-second limit. Browser collection has a 90-second browsing limit after the feed appears, and remote image/sync work is bounded. A terminated function can leave a collecting row. A later request marks rows older than seven minutes as needing attention before claiming another batch. Temporary cache directories are removed; deployments exclude local secrets, session files, listing caches, and test artifacts.

## Verification

- First collection through the cloud browser, with the controller run from the PC: batch 2, 200 listings, 194 cached images, 191 eligible new batch records.
- App-triggered hosted controller: batch 3, completed in 41 seconds, 200 listing rows mapped to the batch, 193 cached cover images. The app displayed 427 eligible picks across the accumulated cache after its automatic reload.
- The live database rejected a competing active-batch claim. An unauthenticated hosted API request returned HTTP 401.
- Ten unit tests pass. Browser fixtures verify collection startup, duplicate-tap prevention, completion, retryable failure, existing interactions, responsive widths, and accessibility. Zero axe violations and no unhandled browser errors were found.
- The authenticated production app reported no console warnings or errors. The tested Vercel deployment had no error logs.

The local collector was idle during the hosted run. Remaining acceptance check: use the installed iPhone PWA to start collection while the PC is powered off. Scheduling and sustained unattended reliability remain untested. No scheduled collection has been added. Browserbase usage consumes the account's browser-time allowance; check the account before running repeated refresh tests.
