-- Run once on the production D1 after the schema-extra tables/columns exist.
-- Creates the owner account and assigns every existing row to it. OWNER placeholders are replaced by scripts/migrate-owner.mjs.
INSERT INTO users(id,google_sub,email,display_name,handle,avatar_url,created_at)
 VALUES('__OWNER_ID__',NULL,'__OWNER_EMAIL__','__OWNER_NAME__','__OWNER_HANDLE__',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(email) DO NOTHING;
UPDATE activities SET user_id='__OWNER_ID__' WHERE user_id='';
UPDATE transactions SET user_id='__OWNER_ID__' WHERE user_id='';
UPDATE trips SET user_id='__OWNER_ID__' WHERE user_id='';
UPDATE categories SET user_id='__OWNER_ID__' WHERE user_id='';
UPDATE attachments SET user_id='__OWNER_ID__' WHERE user_id='';
UPDATE public_entries SET user_id='__OWNER_ID__' WHERE user_id='';
INSERT OR IGNORE INTO user_settings(user_id,key,value) SELECT '__OWNER_ID__',key,value FROM app_settings;
