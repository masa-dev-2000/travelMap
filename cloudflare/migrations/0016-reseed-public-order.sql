-- 0015 seeded every pre-existing publication in a single pass, so those rows took their
-- sequence from insertion rowid rather than from when each record happened. Imported
-- history therefore played back jumping across months. Renumber the existing rows into
-- the order the feed and selected playback already use: date, then occurred_at, then id.
-- Entries published after this run keep taking the next sequence as they become eligible.
CREATE TABLE public_entry_reseed_map (
 entry_id TEXT PRIMARY KEY,
 rn INTEGER NOT NULL
) STRICT;
INSERT INTO public_entry_reseed_map(entry_id,rn)
 SELECT s.entry_id,ROW_NUMBER() OVER (ORDER BY p.date,COALESCE(a.occurred_at,''),s.entry_id)
 FROM public_entry_sequence s
 JOIN public_entries p ON p.id=s.entry_id
 LEFT JOIN activities a ON a.id=p.activity_id;
-- Shift clear of the target range first: seq is the rowid, so renumbering in place would
-- otherwise collide with rows that have not been moved yet.
UPDATE public_entry_sequence SET seq=seq+1000000000;
UPDATE public_entry_sequence SET seq=(SELECT rn FROM public_entry_reseed_map m WHERE m.entry_id=public_entry_sequence.entry_id);
DROP TABLE public_entry_reseed_map;
-- Existing cursors recorded a position in the old numbering, which no longer identifies
-- the same set of entries. Restart them instead of silently hiding unseen records.
UPDATE public_read_cursors SET last_seen_seq=0;
