-- One bounded handoff receipt per browser lease. Lookup uses the existing (user_id,client_id) PK.
-- Append-only migration: do not reapply to an already upgraded database.
ALTER TABLE location_capture_leases ADD COLUMN handoff_hash TEXT;
ALTER TABLE location_capture_leases ADD COLUMN handoff_destination TEXT;
ALTER TABLE location_capture_leases ADD COLUMN handoff_expires_at INTEGER;
ALTER TABLE location_capture_leases ADD COLUMN handoff_claimed_at INTEGER;
ALTER TABLE location_capture_leases ADD COLUMN handoff_next_at INTEGER;
