# Issues #2–#7: implementation and release gates

Base: `5bba478823e2dda9b1a3a8107483a6448301a1cb`. This branch does not deploy or alter production data.

## Implemented choices

- **#2:** DOM/keyboard order: title → category → rating → photos → memo, followed by payment and publication review. Title uses the existing optional `observed_place_name` field (plan A, label `タイトル（場所名）`); no separate title column, mandatory title, invented backfill, or change to the publication boundary. This reversible compatibility choice must be included in review. IME confirmation is not Next; memo Enter is newline; explicit completion never submits; the category sheet distinguishes selection from cancellation. Photo completion does not steal focus after another user action.
- **#3:** A single form-scroll/visual-viewport owner replaces unconditional `window.scrollTo(0,0)`. Textarea height is bounded so native caret scrolling can keep the current line visible. Actual iOS keyboard behavior is a release gate, not certified by desktop/mobile-width tests.
- **#5:** Only the record-start status form, CSS and submit handler are removed. Travel mode, counts, manual position recording and undo remain. Shared status data and other settings stay compatible.
- **#6:** One source-aware map card is reused by ordinary pin clicks, public traveller markers and replay. Public data never falls back to private endpoints; date-only records never display the ordering-only noon timestamp. Only `purpose=photo` private image attachments are fetched, with cancellation/object-URL cleanup. No new comment-posting system, fake comment counts, or fake public ratings. Route-line/overview details stay available.
- **#7:** `replay.js` remains separate from the story player. Speed is 0.25–4× (trial range), standard timing is 2 seconds per normal-record interval (trial value); automatic positions only fill geometry, not comment events. Replay uses a snapshot and stable keys, handles gaps as separate line chunks, pauses in the background and does not reopen a manually closed card on every frame. Finish old playback before starting the new mode. Reduced-motion users can inspect records without forced animation.
- **#4:** Foreground-only automatic position capture on the map, start and record pages. Fresh GPS timestamp/accuracy, immediate first sample, 5-minute cadence, bounded retries of one immutable sample, private-only storage and per-row deletion. Same-browser exclusivity is enforced by a server lease (90 seconds, renewal every 30 seconds) plus a page ID. Handoff is single-use, same-origin/same-tab, short-lived, and does not duplicate the first sample. Visibility resume rotates the capture generation so a delayed stop cannot revoke a new lease. OFF cancels new captures/retries; a previously sent request may finish and is reported separately.

## Storage / activation

`0011-location-samples.sql` adds private `location_samples` and `location_capture_leases`. `schema-extra.sql` is updated for fresh/test initialization. No activity/category/expense/public rows are generated. The new worker route is behind the existing authentication, terms and Origin checks and additionally validates write Origin. Client-supplied user IDs are ignored; every query/delete uses the authenticated owner. The migration checker compares old+upgrade against fresh cumulative initialization, preserving existing user data. Missing migration fails closed for this feature only.

Production activation requires a separately approved D1 migration, normal deployment review and real-device tests. No migration/rollback should remove previously saved data. Revert the feature code or disable its entry points rather than deleting samples. Existing code can run against the additive schema.

## Verification records

Local, Node 22.16 + built-in SQLite: 18 dependency-free tests passed for location input/ownership/leases/handoff/idempotency/cursors, record display, replay timing/snapshot/gaps, focus calculations/IME guard, capture cadence/visibility/OFF/retry.

Additional CI: existing Worker suite + new auth/Origin routing assertions; TypeScript check; build dry-run; upgrade/fresh-schema comparison; real Chromium DOM tests with synthetic API/GPS/map-renderer fixtures. CI results, not this document, determine whether those checks passed.

## Required human/device review before merge/release

- iPhone Safari and home-screen launch: actual Japanese/numeric keyboards, caret visibility with long memo, photo picker cancellation/return, screen rotation, lock/restore and account change.
- Real MapLibre/WebGL: near-edge popup placement, long/private/public photos, map styles, multiple travellers, story↔normal playback switching and background pause.
- Confirm title compatibility choice A, and adjust trial replay speed/timing based on representative trips.
- Confirm private samples should not appear under an unrelated trip/category filter; they remain accessible in the private location log.

Generated UI mockups are not screenshots of this implementation. Browser fixture screenshots are labelled test fixtures; no real iPhone, GPS, production database or real WebGL result is claimed.
