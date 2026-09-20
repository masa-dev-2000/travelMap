CREATE TABLE IF NOT EXISTS user_mutes (
 viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 muted_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(viewer_user_id,muted_user_id),
 CHECK(viewer_user_id <> muted_user_id)
) STRICT;
CREATE INDEX IF NOT EXISTS user_mutes_muted ON user_mutes(muted_user_id,viewer_user_id);
