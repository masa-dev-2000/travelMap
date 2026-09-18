-- Footprints: a signed-in viewer opened another traveller's marker/records. At most one row per viewer, owner and JST day; shown to the owner without counts.
CREATE TABLE IF NOT EXISTS footprints (
  id TEXT PRIMARY KEY,
  viewer_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(viewer_id,owner_id,day)
);
CREATE INDEX IF NOT EXISTS footprints_owner ON footprints(owner_id,created_at);
