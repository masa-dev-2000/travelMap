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

## Follow-up lifecycle repairs (after 7d0c79d)

- Opening Profile, Record, another detail or the custom-period view invalidates pending
  playback even when a loader ignores its AbortSignal. The player's own option picker
  remains an intentional playback entry point and is not cancelled by opening itself.
- Settings and a hidden page pause an already displayed queue without discarding its
  snapshot. If playback has not been displayed yet, they cancel it instead. Returning
  to the page or closing Settings never starts that old request. Page exit also cancels.
- Read callbacks are bound to the current playback generation; an old callback cannot
  acknowledge a record after stop, selection change or authentication loss.
- Locationless records never show a previous or future record's playback pin. A marker
  is created only when the current record has coordinates, and removed on an unlocated step.

Regression evidence: `playback-lifecycle.test.ts` adds five Node cases (all five fail
against the pre-repair controller and pass with the repair). `browser-playback-lifecycle.py`
adds four app-level cases, run with both the fake renderer and real MapLibre by
`browser-real-map.py`. The CI run/revision recorded in PR #14 is the release evidence;
this document alone does not assert a successful run or authorize production changes.

## First-play startup race (bd1860e)

Run 35517701936 exposed a real initialization race: after the first viewer feed became
available, completing private Profile initialization issued another viewer reload and
aborted the user's pending Play request. The Play promise returned without starting.
The original obscured-card assertion and timeouts were not weakened to hide this failure.

The private panel now bootstraps its own summary, activities and transactions without
reloading the already loaded viewer feed. Later user refresh/save operations still await
the public metadata refresh. `test_play_during_profile_bootstrap` holds the two requests
explicitly and verifies that finishing Profile does not issue a third feed or cancel Play.
This regression runs with both renderers, alongside the existing lifecycle cases.

Current test matrix: 83 Node cases, 18 standard-browser cases plus four lifecycle cases,
and seven real-MapLibre cases plus four lifecycle cases. These are configured case counts;
final successful execution, checked-out revision and artifact IDs must be recorded on
PR #14. A previous run's success is not evidence that a later commit passed.

## Production release (2026-09-21)

Merged as `6f8c4b09ed8cf14da3b773ddf813a71d8582d8cf` from verified head `4bafc50`
(CI run 35518255675, core + browser success). The merge tree is byte-identical to the
verified head, so no re-verification was required. Local re-run before merging: tsc,
83 Node cases, build, 0011..0015 migration integration, index/paging regression,
18 standard-browser cases, 7 real-MapLibre cases and 4+4 lifecycle cases, plus a
production-config dry-run confirming D1 `travelmap`, R2 `travelmap-files` and vars.

Production D1 was exported to a Git-external backup and restored into an isolated
SQLite database (counts matched, `integrity_check` ok, zero FK violations) before any
change. The live structure was read first: `user_mutes`, `public_read_cursors` and
`public_entry_sequence` were absent, so 0013 → 0014 → 0015 were each executed once via
`d1 execute --remote --file`. The `d1_migrations` ledger is still empty and was not used
as evidence. After the migration, columns, indexes and foreign keys verified, the legacy
cursor table retained, and users 4 / activities 353 / transactions 267 /
public_entries 353 / 396,095 JPY unchanged.

Worker Version `d43a7e3b-cb07-408f-905e-d8f1cbbf8512` is deployed at 100% from that
merge commit; existing secrets were not recreated. Against production, the owner's
authenticated session returned 200 from `/api/private/viewer-feed` and
`/api/private/mutes`, with `publication_seq` 299–351 and `unread` present, and
`public_entry_sequence` seeded 353 rows on first observation — so 0015 works on live
data. Unauthenticated private endpoints return 401 and the public feed exposes no mute,
read or internal-ID fields.

Not verified in production: playback itself, because running it would update the
owner's real read cursors; mute toggling, for the same reason; iPhone hardware and
live GPS. Those remain covered only by the automated cases above.

## Sequence reseed (0016)

Production verification with a test viewer showed that default unread playback did not
follow time. `ensurePublicOrder` assigns the sequence with
`ORDER BY COALESCE(publish_at,''), rowid`, and every pre-existing publication has a NULL
`publish_at`, so 0015's one-pass seeding fell back to insertion rowid. For the imported
history that order is unrelated to when the records happened: masa's 300 entries contained
140 backward date steps, 106 of them jumping back more than a week and the worst 249 days.
The three seeded demo accounts, written in date order, showed none.

This is a defect in the seeded data, not in the ordering contract. The contract — a stable
first-visible sequence that editing a date cannot reorder — still holds, and entries
published from now on take their number as they become eligible, which is already
chronological. Only the single batch that 0015 adopted was wrong.

`0016-reseed-public-order.sql` renumbers the existing rows in the order the feed and
selected playback already use (`date`, `occurred_at`, `id`), in place, so the table
definition and `AUTOINCREMENT` behaviour are unchanged and later entries keep taking higher
numbers rather than slotting into their date. Sequence numbers are shifted clear of the
target range first because `seq` is the rowid. Existing cursors recorded a position in the
old numbering, which no longer identifies the same set, so they restart at zero rather than
silently hiding unseen records — the same conservative choice 0015 made.

`check-location-migration.py` seeds four entries whose insertion order contradicts their
dates, reproducing the production shape, and asserts the replay order afterwards. It fails
against 0011..0015 alone and passes with 0016. The same file's migration glob previously
matched local-only `*.local.sql` fixtures and crashed in any working tree that had them;
it now selects numbered migrations only.
