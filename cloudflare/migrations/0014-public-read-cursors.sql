CREATE TABLE IF NOT EXISTS public_read_cursors (
 viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_seen_entry_id TEXT NOT NULL REFERENCES public_entries(id) ON DELETE CASCADE,
 last_seen_order_key TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(viewer_user_id,author_user_id),
 CHECK(viewer_user_id <> author_user_id)
) STRICT;
