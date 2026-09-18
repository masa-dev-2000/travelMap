-- Run once on production. Lookups by activity were full table scans (351 entries x 269 transactions per feed load).
CREATE INDEX IF NOT EXISTS transactions_activity ON transactions(activity_id);
CREATE INDEX IF NOT EXISTS public_photo_objects_entry ON public_photo_objects(entry_id);
CREATE INDEX IF NOT EXISTS activities_trip ON activities(trip_id);
CREATE INDEX IF NOT EXISTS footprints_viewer ON footprints(viewer_id,day);
