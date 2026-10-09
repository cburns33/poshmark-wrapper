# Personalized feed probe

Observed October 9, 2026 in a signed-in, temporary Chrome session through Playwright.

The normal page requested `/vm-rest/users/{userId}/feed/personalized_v2` and received HTTP 200. No direct HTTP client, cookie export, endpoint replay, or anti-bot bypass was used by the successful probe.

| Observation | Initial batch | Next scroll batch |
| --- | ---: | ---: |
| Distinct listing IDs within response | 42 | 34 |
| Listings with extracted brand | 41 | 34 |
| Pagination field | `more.next_max_id` | `more.next_max_id` |

These are per-response counts. Overlap between responses was not measured. The results establish two successful observations, not long-term reliability or a guaranteed batch size.

Listing records were nested under paths such as `data[1].content.data[0].post`. Observed fields included `id`, `title`, `brand`, `price_amount.val`, `price_amount.currency_code`, and `cover_shot.url`. The live feed DOM supplies outbound listing links. A future collector should scope extraction to the intended listing units and preserve their presentation order, excluding brand carousels and unrelated modules.

Structured brand is useful but remains seller-provided metadata. One title described an Autograph sweater while its brand field said Scotch & Soda. This demonstrates disagreement between title and brand; it does not establish which label is correct.

Recommended filtering: use normalized structured brand when present, apply the user's 53-brand blocklist, and exclude asking prices above $150. When brand is absent, fall back to blocked-brand mentions in the title, as authorized by the user. Preserve distinctions between factory and mainline names. Unknown labels remain visible unless their titles match the blocklist. Keep the original feed order. No filter engine was implemented during this probe.

The capture script is `feed-probe.cjs`. It inspects one normal feed response on startup after sign-in; `inspect` arms another capture and scrolls to the bottom. Other terminal commands are `status`, `screenshot`, and `quit`. Launch with an interactive terminal or `tty=true` to keep commands usable. Playwright must be available through Node's normal resolution or NODE_PATH. The browser context is temporary; the script does not export authentication state. The local probe browser was closed after the successful test.

Only the latest response summary and five samples are retained in ignored `probe-output/response-summary.json`. Raw response bodies and credentials were not saved. A failed earlier attempt to view the endpoint through the in-app browser was blocked by that browser client; the successful observations came from responses to normal page browsing in Playwright.

Next implementation milestone: a bounded collector that preserves card links and source order, deduplicates IDs across batches, applies the configured filters, and saves a modest cache for a plain single-photo grid. Scheduled collection and a polished frontend remain out of scope until this flow is validated.
