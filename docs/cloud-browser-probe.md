# Browserbase free-tier probe

On October 9, 2026, two Browserbase cloud browser sessions used one saved Context. The first session reached the signed-in Poshmark feed and showed 36 cards. After it closed, a separate session opened the same personalized feed without another sign-in and showed 48 cards. These were bounded access checks; they did not collect or sync a listing batch. The PC ran the probe controller, so this does not yet prove an on-demand collection flow while the PC is off.

The repeatable probe is `cloud-probe.cjs`. Set `BROWSERBASE_API_KEY` in ignored `.env.local`, then run `node --env-file=.env.local cloud-probe.cjs login`. Open the printed session ID at `https://www.browserbase.com/sessions/<id>`, choose Live View, and sign in to Poshmark if needed. The probe closes after cards appear. Run `node --env-file=.env.local cloud-probe.cjs verify` to test a new session using the saved Context. The Context ID is stored in ignored `probe-output/browserbase-context.json`. The key, cookies, listing contents, and live-view token are not committed.

The initial live probe succeeded on Browserbase's free tier. Its published limit is one browser hour per month with a 15-minute limit per session. The free tier has no CAPTCHA solving. The two-session result establishes access and login persistence for this date, not sustained reliability or permission from Poshmark. A later Poshmark challenge or expired login may require manual sign-in. See [Browserbase pricing](https://www.browserbase.com/pricing) and [Contexts documentation](https://docs.browserbase.com/platform/browser/core-features/contexts).

Next implementation milestone: adapt the collector to connect to Browserbase, collect a bounded feed batch, and sync it to Supabase from a hosted job. Then connect a protected app action to trigger the job and show collection status. Confirm collection works with the PC off before scheduling it.

## Handoff for the next usage window

Start from commit `ba5c9f2` or later on `main`. The probe has already established cloud feed access and saved-login reuse, so begin with the collection path. Reuse the existing listing mapping, filter rules, and Supabase schema. Keep Browserbase and Supabase secret keys in server-side environment variables. A client request must be authenticated and restricted to the owner before it can start collection. Browserbase's 15-minute free-tier session limit bounds the first run.

Implement and verify in this order:

1. Run a bounded Browserbase collection and sync from a hosted worker. Confirm a new `collection_batches` row, listing rows, and cover images in Supabase.
2. Add an owner-protected app action that starts the worker and displays running, completed, or failed status. A second tap should not launch a duplicate run.
3. With the PC off, start a run from the deployed phone app. Confirm Refresh shows eligible listings from the new batch. Record elapsed time and Browserbase minutes consumed.

Current `Refresh` only rereads the Supabase cache. No hosted worker, trigger, or PC-off collection is present yet. If the saved Poshmark session expires or a challenge appears, the owner may need to reopen Browserbase Live View and sign in. Stop the run on that state and report it in the app.
