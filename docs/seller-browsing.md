# Filtered seller browsing

Implemented October 14, 2026. Release verification is pending the approved live inventory test.

## Use

Browse seller opens the seller of a cached listing. The collector selects Men, My Size, and available inventory in Poshmark's desktop closet view. It imports only responses whose request confirms all three filters. Poshmark's saved sizes are the source of truth; the app does not infer sizes from titles. Shoes, accessories (including hats), and suits are excluded by category. Existing price, brand, and slim-title filters apply to the resulting cards.

The seller view shows explicit sizes and an outbound link to the filtered original closet. Save, Hide, and Undo work across the shared listing cache. Saved includes seller finds. All picks excludes listings imported only from seller closets.

Browse seller reuses a successful seller snapshot younger than 24 hours. Update seller requests a fresh snapshot. Refresh reloads cached results. Each collection is capped at 200 items, 12 scrolls, and a 60-second browsing window, within the existing hosted function budget. Empty matching inventory is a valid completed snapshot.

## Storage and worker

Listings gain seller_username. Suggested collection captures creator_username when available; older cached cards resolve it from the listing's scoped seller widget. The owner-protected API accepts only an ID already present in that owner's cache, never a caller-supplied URL or seller identity.

Collection batches store seller identity and the seed listing ID. seller_inventory stores ordered snapshot membership, uses owner RLS, and grants frontend read access only. Seller imports preserve existing Suggested source, position, last-seen time, and batch metadata. No scheduled collection or automatic scan on Save is added.

## Verified so far

- Desktop UI confirmed the normal inventory request includes department Men, size.my_size_v3 true, and available inventory.
- The scoped seller widget was verified on an existing cached listing.
- Fifteen unit tests pass, including API owner validation, listing validation, cache reuse, forced refresh, strict filtered-response acceptance, category exclusions, and preserving Suggested ordering.
- Browser fixtures pass for seller filtering, explicit sizes, Save/Hide/Undo, returning to All picks, existing app interactions, mobile layouts, and accessibility. Zero axe violations or unhandled browser errors.
- Database migration applied and seller-inventory read policy verified. Security advisors show only the previously accepted leaked-password-protection warning.

Still required before release: a real bounded seller import and matching cached-record verification. The user's large-data permission question is pending. Browserbase quota and saved-login expiry remain operational limits. An incomplete bounded batch is labeled partial; the app does not promise an entire large closet.
