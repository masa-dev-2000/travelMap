-- Sign-up flow. Accounts that existed before it are treated as already signed up.
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE users ADD COLUMN onboarded_at TEXT;
UPDATE users SET terms_accepted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),onboarded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE terms_accepted_at IS NULL;
