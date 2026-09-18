-- Short status line shown on the shared map ("heading to Aso"). NULL = none; status_at is when it was last changed.
ALTER TABLE users ADD COLUMN status TEXT;
ALTER TABLE users ADD COLUMN status_at TEXT;
