-- Public map coordinates are explicitly selected snapshots, never a join to private locations.
CREATE TABLE IF NOT EXISTS public_entry_locations (
 entry_id TEXT PRIMARY KEY REFERENCES public_entries(id) ON DELETE CASCADE,
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180)
) STRICT;
-- Original attachments remain private in R2; published copies use separate keys.
CREATE TABLE IF NOT EXISTS public_photo_objects (
 id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES public_entries(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, caption TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS request_receipts (
 id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, response_json TEXT NOT NULL
) STRICT;
-- Owner preferences, e.g. whether new records start as published.
CREATE TABLE IF NOT EXISTS app_settings (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
) STRICT;
-- Accounts (Google login) and browser sessions. Session ids are stored hashed.
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 handle TEXT NOT NULL UNIQUE, avatar_url TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
 id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS user_settings (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL,
 PRIMARY KEY(user_id,key)
) STRICT;
-- Ownership. Added without REFERENCES because SQLite cannot add a NOT NULL foreign key column with a default; the app enforces it.
ALTER TABLE activities ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE trips ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE attachments ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE public_entries ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
-- Publication granularity: exact coordinates, city name only, or no location. publish_at delays visibility.
ALTER TABLE public_entries ADD COLUMN precision TEXT NOT NULL DEFAULT 'exact' CHECK(precision IN ('exact','city','hidden'));
ALTER TABLE public_entries ADD COLUMN publish_at TEXT;
CREATE INDEX IF NOT EXISTS activities_user ON activities(user_id,occurred_at);
CREATE INDEX IF NOT EXISTS transactions_user ON transactions(user_id,occurred_at);
CREATE INDEX IF NOT EXISTS public_entries_user ON public_entries(user_id,status);
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN tip_url TEXT;
-- Map marker icon chosen by the user (emoji). NULL falls back to the Google avatar, then the initial.
ALTER TABLE users ADD COLUMN icon TEXT;
-- Uploaded map marker image lives in R2 at icons/<user_id>.png. NULL = no image; the value changes on every upload and busts caches.
ALTER TABLE users ADD COLUMN icon_version INTEGER;

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
-- Short status line shown on the shared map ("heading to Aso"). NULL = none; status_at is when it was last changed.
ALTER TABLE users ADD COLUMN status TEXT;
ALTER TABLE users ADD COLUMN status_at TEXT;
CREATE INDEX IF NOT EXISTS transactions_activity ON transactions(activity_id);
CREATE INDEX IF NOT EXISTS public_photo_objects_entry ON public_photo_objects(entry_id);
CREATE INDEX IF NOT EXISTS activities_trip ON activities(trip_id);
CREATE INDEX IF NOT EXISTS footprints_viewer ON footprints(viewer_id,day);
-- Sign-up: NULL terms_accepted_at = the account has not accepted the terms yet and can only use the sign-up page. onboarded_at = first profile setup finished.
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE users ADD COLUMN onboarded_at TEXT;

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
-- One bounded handoff receipt per browser lease. Lookup uses the existing (user_id,client_id) PK.
-- Append-only migration: do not reapply to an already upgraded database.
ALTER TABLE location_capture_leases ADD COLUMN handoff_hash TEXT;
ALTER TABLE location_capture_leases ADD COLUMN handoff_destination TEXT;
ALTER TABLE location_capture_leases ADD COLUMN handoff_expires_at INTEGER;
ALTER TABLE location_capture_leases ADD COLUMN handoff_claimed_at INTEGER;
ALTER TABLE location_capture_leases ADD COLUMN handoff_next_at INTEGER;

-- Viewer-specific social preferences. Public feeds remain viewer-neutral.
CREATE TABLE IF NOT EXISTS user_mutes (
 viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 muted_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(viewer_user_id,muted_user_id),
 CHECK(viewer_user_id <> muted_user_id)
) STRICT;
CREATE INDEX IF NOT EXISTS user_mutes_muted ON user_mutes(muted_user_id,viewer_user_id);
CREATE TABLE IF NOT EXISTS public_read_cursors (
 viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_seen_entry_id TEXT NOT NULL REFERENCES public_entries(id) ON DELETE CASCADE,
 last_seen_order_key TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(viewer_user_id,author_user_id),
 CHECK(viewer_user_id <> author_user_id)
) STRICT;
