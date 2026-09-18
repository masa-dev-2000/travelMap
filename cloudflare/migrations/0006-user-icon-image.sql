-- Run once on production: uploaded map marker image (R2 icons/<user_id>.png).
ALTER TABLE users ADD COLUMN icon_version INTEGER;
