# Issues #9–#13 — PR #14 review repair

## Scope and status

Repairs the 11 findings in review 5260676304, originally on 0513371. Work continues on
`feat/issues-9-13-map-social-playback`. No production DB changes or deployments are part
of this repair. Main, release approval, iPhone and live GPS verification remain separate.

## Repair checklist and acceptance evidence

| Review | Repair | Regression test |
|---|---|---|
| 1 | Default: only unread, person by person. Selected: only chosen period, including read entries. No implicit all-history fallback. | viewer-state + browser selected/unread |
| 2–3 | Handle contract in browser/API, immutable ID in DB; one state drives map/strip/queue. Optimistic mute cancels outstanding feed, clears selected user and player. | viewer-api + browser mute |
| 4 | Stable first-visible sequence independent of editable dates and random IDs; scheduled/hidden publications assigned only once eligible. | viewer-api same-day/backdate/scheduled |
| 5 | Monotonic read UPSERT with SQL WHERE, not a JS read-then-write check. | viewer-api late cursor |
| 6 | New cursor has no cascading FK to an individual entry. | viewer-api deletion |
| 7 | Both playback modes report displayed cards. Hidden pages stop progression and read timers; return never resumes automatically. Server checks current visibility/mute. | viewer-state + browser hidden/read |
| 8 | Profile includes identity/edit/owned records/financial/trip controls. Settings is one dialog. Public details and custom period have registered transient views. | browser navigation/detail |
| 9 | One StoryPlayer, one compact bar: play/pause, seek, tap speed, restart, stop. Shared pin card, locationless fallback, private-photo purpose filter. | browser map/seek/compact |
| 10 | Right-top profile button, zoom and friends toggle, full-route button are no longer created. Map style is generated in Settings. GPS switch alone stays top-right. | browser navigation/compact |
| 11 | Selection/period/mute/auth/error invalidate controller generation and abort pending fetch. Stale results cannot start an old playback. | viewer-state deferred loads |

## State and replay contract

- Browser `handle` is always the public handle, never mixed with internal user IDs. Server
  resolves handles to immutable IDs for stored mute/read state. Feed refresh reconciles changes.
- Default queue ignores map period and includes all non-muted **other** users with unread
  records, ordered by earliest unread sequence, one author at a time. Within that mode,
  entries play in first-visible sequence order.
- Selected replay uses the current JST calendar period. It plays that person's records in
  public date/time order, with sequence as deterministic tie-breaker; an empty period stays empty.
- A read cursor means “acknowledged up to this publication sequence for this author”. Opening
  a later card therefore acknowledges earlier sequence entries too, per v2's cursor decision.
  It does **not** claim each skipped card was watched. Public display time is never synthesized.
- A visible card must remain present for 400ms before read acknowledgement. Closing a card,
  scrubbing away, opening a modal or hiding the page cancels acknowledgement. Only a successful
  server response changes persisted-read indication. Failures are surfaced and may be retried
  on a later view; no cross-account persistent retry queue is kept.
- Queue data is cloned when playback starts. New records wait for the next run. Muting or
  revoking an included record stops the current run instead of silently replacing its data.
- Stories retains eligible already-read users, with a ring only for unread. Icon selection
  itself never marks records read. Tapping the selected icon again clears selection.
- Anonymous viewers use public entries and page-session-only read state; saved mute/read
  requires login. Anonymous navigation still offers Profile / Record / Settings and login.
- Own trip replay uses private records and never submits private IDs to public read tracking.
  Shared `/?play=handle&trip=name` entry points remain routed through the same player.

## DB and security

0013 and 0014 are not edited. New apply-once **0015-stable-public-order.sql** adds an
AUTOINCREMENT sequence registry and corrects the cursor shape. It archives the date-based
cursor table rather than deleting legacy information; old ambiguous cursors restart at zero
so unseen entries are not silently suppressed. Legacy rows may be absent on fresh installs.
The sequence is **first observed eligible by the personalized feed**, not a recovered historic
publication timestamp. Already eligible pre-migration records are seeded in stable row order.
Subsequent date edits do not change sequence; delayed/mode-hidden publications become new
only when eligible. Deletion never reuses a sequence number or deletes the current cursor.

Public and personalized feeds share `loadPublicEntries` privacy projection; personal state
never enters the public edge cache. Worker authentication, signup and Origin checks stay in
front of viewerApi. Read acknowledgements recheck published status, delay, travel mode and mute
in the write itself. Muting is not a block or deletion and does not remove the public record.

Indexes: mute `(viewer_user_id,muted_user_id)`, cursor `(viewer_user_id,author_user_id)`,
unique sequence entry_id, sequence `(author_user_id,seq)`. EXPLAIN tests cover each lookup.
The current all-entry feed remains unpaginated; larger-scale paging is a future performance
change, not falsely claimed complete here.

## Verification and release

`npm run check`, `npm test`, `npm run build`; `check-location-migration.py` now compares
old + 0011..0015 with fresh initialization and retained existing data. Existing GPS index
checks remain. Browser fixtures now provide the real viewer-feed contract with multiple
users, read/unread, muted user, self and old/out-of-period records. Real MapLibre/WebGL runs
use a blank synthetic style and controlled API/GPS; they do not certify iPhone/live GPS.
Record the final tested commit/run in PR #14, not success based only on this checklist.

Production is unchanged. Production previously had an empty d1_migrations ledger despite
applied schemas: never run `migrations apply` or replay 0011/0012 from that list alone.
Verify current structure and backup, then apply only missing 0013 → 0014 → 0015 once and
verify columns/FK/indexes before deploying code. Rollback code and schema recovery are separate;
do not delete added data to roll back UI. Preserve the archived legacy cursor table.
