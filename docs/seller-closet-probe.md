# Seller closet feasibility probe

Validated October 14, 2026 using the saved Browserbase Context and normal Poshmark page navigation. The user authorized a probe of up to 200 items from one seller. No inventory was imported into Supabase and no production code changed.

## Findings

- The selected closet had 66 available items. Initial HTML rendered 48 cards; scrolling loaded another 18. All 66 rendered cards had unique listing IDs, explicit sizes, and listing links.
- The observed inventory response used `/vm-rest/users/{username}/posts/filtered`. Its request included available-inventory filters, relevance sorting, a count of 48, and an opaque `max_id` cursor. The terminal response reported total 66 and no next cursor. This verifies one additional page and termination, not repeated pagination in a larger closet.
- All 18 response items included title, brand, size, size_obj, category, category_v2, department, creator_id, creator_username, price_amount, cover_shot, and inventory.
- Explicit size examples included L, XL, and L/G/G. Size normalization must handle equivalent letter labels and retain the raw value. Numeric waist and inseam formats were not represented in the small reported sample and still need fixture coverage or a relevant future observation.
- The listing page includes the signed-in user's closet link in its header. Seller resolution must use listing metadata or a scoped seller link, rather than the first closet link on the page.
- This closet contains women's listings, so its item counts do not establish how many would match the user's intended wardrobe. The user subsequently confirmed Men and their saved Poshmark My Sizes as requirements.

## Implementation milestone

Build a bounded seller collector that combines initial rendered cards with structured metadata, follows normal scrolling, and stops at 200 items, inventory exhaustion, or existing hosted time limits. Verify category and size metadata for initial-page items as well as subsequent response items before applying filters. Keep seller inventory membership separate from Suggested feed ordering.

Add Browse seller to cards and show cached seller items using existing brand, price, and slim-title rules. Add category-specific size preferences: L for tops/shorts/pants, or pants waist 34 through 36 with inseam 32 when stated; waist-only matches remain visible with length unverified. Exclude shoes, hats, accessories, and suits. User authorization for full implementation has not yet been given in this probe task.

Local probe script and small field summary are in ignored output/. No credentials or browser session URLs were added to tracked documentation.
