# Interface review and implementation

October 9, 2026. Review baseline: `b3ea831`. Method: Jakub Krehel's [better-interface](https://github.com/jakubkrehel/skills/tree/main/skills/better-interface), including better-accessibility, better-layout, better-writing, better-typography, better-colors, and better-ui. These skills were installed in the local Codex skills directory.

## Scope and coverage

The complete sign-in and cached browsing flow: sign-in, initial load and refresh, errors, empty feed, All picks, Saved, listing photos, Save, Hide, and outbound links. The stack is vanilla JavaScript with Vite and plain CSS, Supabase Auth, Postgres, and private Storage. The existing serif heading, warm neutral palette, two-column mobile grid, and photo-first browsing pattern are retained.

Project conventions came from AGENTS.md, README.md, and docs/project-status.md. There is no separate design-system document or component library. Collector behavior, database schema, and alternative card designs are outside this pass.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | index.html form and view controls; src/app.js action handlers; keyboard focus checks; axe scans; forced-colors mode | Focus and selected-state fixes implemented |
| Layout | Hosted mobile feed; src/style.css grid, cards, and header; widths 320, 390, 540, 760, 1100, and 1440; long brand and title fixtures; RTL | Link cues, card alignment, and adaptable feedback implemented |
| Writing | Labels and errors in index.html and src/app.js; loading, empty, failed-write, and failed-sign-in states | Undo and recovery copy implemented |
| Typography | Computed font sizes and line heights; numeric values; font synthesis; 200% root text sizing | Relative sizes, larger controls, wrapping brands, and tabular numbers implemented |
| Colors | Computed mobile text colors against the painted page background; input boundaries; axe scans | Failing contrast pairs corrected and remeasured |
| UI | Photo edges and outbound indicators; hover rules; selected/pressed, pending, loading, and missing-photo states | Image outlines and touch-safe hover rules implemented |

## Findings

Locations below refer to the baseline commit so the Before column can be reproduced after implementation. Every row was implemented in this pass.

| Severity | Domain | Location at b3ea831 | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Colors | src/style.css:19, src/style.css:40, src/style.css:48 | Title #77726b on #f8f7f4: 4.45:1; disclaimer #827d74 on #f8f7f4: 3.82:1; input border #c9c5be on white: 1.72:1 | Title/disclaimer #696660: 5.34:1; input border #8a8278: 3.79:1 | Text falls below WCAG 1.4.3's 4.5:1 threshold; the input boundary falls below 1.4.11's 3:1 threshold |
| HIGH | Writing | src/app.js:136 | Hide removes a card with no reversal control | Persistent Undo Hide, with a stack for consecutive hides; failed Undo retains its retry action | A repeated removal needs a reversal path |
| HIGH | Writing | src/app.js:55, src/app.js:127, src/app.js:141, src/app.js:200, src/app.js:226 | Errors omit recovery or display raw service messages; action errors are below the entire feed | Recoverable copy, card-local Save/Hide errors, invalid credential guidance, and a feed retry button | Error recovery must be visible where the operation fails |
| HIGH | Accessibility | index.html:46; src/style.css:29 | Selected listing view has only a different color treatment | Checkmark plus color and aria-pressed | Selected state must have a visible cue beyond color, WCAG 1.4.1 |
| MEDIUM | Accessibility | src/app.js:122, src/app.js:125, src/app.js:136, src/app.js:139 | Focused actions are disabled, then replaced by rebuilding the grid | Keep Save in place; pending actions use guarded aria-disabled; Hide advances to the next card; Undo restores focus; Retry returns focus to Refresh | Keyboard browsing needs a stable continuation point |
| MEDIUM | Typography | src/style.css:42 | Save and Hide use 11px text and about 28px targets | 13px-equivalent rem text and 44px minimum targets; prices and counts use tabular figures | The old targets pass the 24px AA floor, but larger controls improve repeated touch browsing |
| MEDIUM | Layout | src/style.css:50 | Mobile hides the Poshmark-link hint; photo indicators require hover | Visible mobile hint and persistent outbound glyph, with a full accessible link name | Photo navigation needs a cue on touch screens |
| MEDIUM | Writing | src/app.js:151, src/app.js:181 | Saved empty state instructs users to save without an exit; initial loading leaves a blank grid | Browse all picks action, explicit loading copy and aria-busy, current-view result counts | Loading and empty states need orientation and a path forward |
| LOW | UI | src/style.css:10, src/style.css:33 | Hover applies on touch; image edges lack an outline | Hover-capable media query and inset black image outline | Avoid latched hover feedback and preserve image boundaries |

Other fixes support these findings: full brand wrapping, aligned card actions despite varying metadata height, inherited unitless line height, relative text sizes, removal of blanket font-synthesis suppression, safe-area padding, and a measured Undo height for scroll clearance. Truncated titles retain their full accessible link name and their original Poshmark destination.

## Verification

Passed:

- `npm test`: seven existing filtering, cache, and cloud-mapping tests.
- `npm run build`: production build succeeds.
- `npm run test:interface`: production code against five synthetic listings and intercepted Supabase requests. No test writes reach the real account. Checks cover the inclusive $150 boundary, blocked and unknown brands, keyboard Save, Saved empty exit, Hide continuation, consecutive Undo, failed Undo, failed Save, pending Refresh focus, refresh failure and retry, empty feed, six viewport widths, 200% text sizing, RTL, forced colors, and invalid sign-in feedback.
- Axe-core 4.14.0: zero violations in the inspected feed, Undo error, empty, final feed, and sign-in error states. The baseline feed had four color-contrast violations.
- Manual screenshot review: mobile cards, long brands, missing photo, aligned actions, and sign-in error.
- Measured custom focus ring: #7b464a on #f8f7f4 is 6.96:1.

Not verified:

- VoiceOver and NVDA spoken announcements on a physical device. DOM semantics, roles, names, and live-region markup were inspected, but this is not a screen-reader speech certification.
- Installed iPhone Safari, landscape safe-area behavior on hardware, and an actual browser-menu zoom run. Automated 200% text sizing and narrow viewport reflow were checked.
- Long translated interface copy. The app is English-only; long listing strings and RTL were checked without adding a translation system.

## Verdict

Approve for the inspected scope. All reported findings were implemented and the relevant checks passed. Physical phone and screen-reader checks remain field verification.

Undo history lasts for the current page session. Reloading ends that history. Refresh reloads collected data; replenishment still runs through the collector.

Production verification: implementation commit 3091e33 deployed through GitHub to https://poshmark-wrapper.vercel.app. Deployment dpl_3TxiYGARe1FAs8RnuPeJKRjZ6xpW is Ready, with a 5-second build. The authenticated mobile feed loaded 187 picks and private images with 44px actions, no horizontal overflow, and zero captured console warnings or errors. A live Hide and Undo restored the first item; a reload confirmed 187 picks again. The signed-out production smoke check passed. The bounded Vercel error-log query returned no logs; browser health was checked through the app itself.
