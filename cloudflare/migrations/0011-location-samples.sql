-- Private foreground GPS samples; independent from activities and public snapshots.
CREATE TABLE IF NOT EXISTS location_capture_leases (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,client_id)
) STRICT;
CREATE TABLE IF NOT EXISTS location_samples (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy REAL NOT NULL CHECK(accuracy >= 0),
  PRIMARY KEY(user_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS location_samples_user_time ON location_samples(user_id,captured_at,id);
