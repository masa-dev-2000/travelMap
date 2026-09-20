-- Stable first-visible ordering, independent of editable dates and random entry IDs.
-- Entries receive a sequence when first observed eligible by the viewer API.
-- Keeping old cursors as an archive avoids inventing which entries were read.
CREATE TABLE public_entry_sequence (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 entry_id TEXT NOT NULL UNIQUE REFERENCES public_entries(id) ON DELETE CASCADE,
 author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX public_entry_sequence_author ON public_entry_sequence(author_user_id,seq);
ALTER TABLE public_read_cursors RENAME TO public_read_cursors_legacy;
CREATE TABLE public_read_cursors (
 viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_seen_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_seen_seq >= 0),
 last_seen_entry_id TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(viewer_user_id,author_user_id),
 CHECK(viewer_user_id <> author_user_id)
) STRICT;
-- Unknown old date cursors restart conservatively, rather than hiding unseen entries.
INSERT INTO public_read_cursors(viewer_user_id,author_user_id,last_seen_seq,last_seen_entry_id,updated_at)
 SELECT viewer_user_id,author_user_id,0,last_seen_entry_id,updated_at FROM public_read_cursors_legacy;
