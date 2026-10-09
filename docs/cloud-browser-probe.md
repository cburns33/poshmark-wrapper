# Browserbase free-tier probe

On October 9, 2026, two Browserbase cloud browser sessions used one saved Context. The first session reached the signed-in Poshmark feed and showed 36 cards. After it closed, a separate session opened the same personalized feed without another sign-in and showed 48 cards. These were bounded access checks; they did not collect or sync a listing batch. The PC ran the probe controller, so this does not yet prove an on-demand collection flow while the PC is off.

The repeatable probe is `cloud-probe.cjs`. Set `BROWSERBASE_API_KEY` in ignored `.env.local`, then run `node --env-file=.env.local cloud-probe.cjs login`. Open the printed session ID at `https://www.browserbase.com/sessions/<id>`, choose Live View, and sign in to Poshmark if needed. The probe closes after cards appear. Run `node --env-file=.env.local cloud-probe.cjs verify` to test a new session using the saved Context. The Context ID is stored in ignored `probe-output/browserbase-context.json`. The key, cookies, listing contents, and live-view token are not committed.

The initial live probe succeeded on Browserbase's free tier. Its published limit is one browser hour per month with a 15-minute limit per session. The free tier has no CAPTCHA solving. The two-session result establishes access and login persistence for this date, not sustained reliability or permission from Poshmark. A later Poshmark challenge or expired login may require manual sign-in. See [Browserbase pricing](https://www.browserbase.com/pricing) and [Contexts documentation](https://docs.browserbase.com/platform/browser/core-features/contexts).

The hosted collector and protected app trigger were implemented and verified later on October 9. See [Cloud refresh](cloud-refresh.md) for the flow, server setup, live results, and remaining iPhone field check.

## Completed implementation handoff

The collection path reuses the existing collector, listing mapping, filter rules, and Supabase schema. Browserbase and Supabase secret keys are server-side production variables. The client request is authenticated and restricted to the owner. A Vercel Function controls the cloud browser with a five-minute function limit.

Verification completed:

1. Browserbase collection and Supabase sync succeeded with 200 listings.
2. The owner-protected app action started the hosted worker; batch 3 completed in 41 seconds with 193 cover images, and the app reloaded to 427 eligible cached picks. The database rejected a duplicate active-batch claim.
3. Remaining field check: start Get new picks from the installed iPhone PWA with the PC off. Browserbase quota and expired-login recovery need monitoring during normal use.

Refresh rereads the Supabase cache. Get new picks starts hosted collection. If the saved Poshmark session expires or a challenge appears, the owner may need to reopen Browserbase Live View and sign in. Collection reports a failure for that state. No schedule has been configured.
