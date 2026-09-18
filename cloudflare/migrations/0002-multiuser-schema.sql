-- Run once on production. Adds accounts, ownership columns and publication options.
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
