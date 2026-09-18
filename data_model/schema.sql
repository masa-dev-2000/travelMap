PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY CHECK(version = 1));
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS trips (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, starts_on TEXT, ends_on TEXT, description TEXT NOT NULL DEFAULT '',
 CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
) STRICT;
CREATE TABLE IF NOT EXISTS categories (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('activity','expense','income')),
 name TEXT NOT NULL, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(id,kind)
) STRICT;
CREATE TABLE IF NOT EXISTS places (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, latitude REAL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL CHECK(longitude BETWEEN -180 AND 180), address TEXT,
 CHECK((latitude IS NULL) = (longitude IS NULL))
) STRICT;
CREATE TABLE IF NOT EXISTS activities (
 id TEXT PRIMARY KEY, trip_id TEXT REFERENCES trips(id), occurred_at TEXT NOT NULL,
 timezone TEXT NOT NULL, timezone_basis TEXT NOT NULL CHECK(timezone_basis IN ('recorded','assumed')),
 category_id TEXT NOT NULL, category_kind TEXT NOT NULL DEFAULT 'activity' CHECK(category_kind='activity'),
 memo TEXT NOT NULL DEFAULT '', observed_place_name TEXT,
 latitude REAL CHECK(latitude BETWEEN -90 AND 90), longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 rating INTEGER CHECK(rating BETWEEN 1 AND 5), place_id TEXT REFERENCES places(id),
 FOREIGN KEY(category_id,category_kind) REFERENCES categories(id,kind),
 CHECK((latitude IS NULL) = (longitude IS NULL))
) STRICT;
CREATE TABLE IF NOT EXISTS transactions (
 id TEXT PRIMARY KEY, trip_id TEXT REFERENCES trips(id), activity_id TEXT REFERENCES activities(id),
 occurred_at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('expense','income','refund')),
 category_id TEXT NOT NULL, category_kind TEXT NOT NULL CHECK(category_kind IN ('expense','income')),
 currency TEXT NOT NULL CHECK(length(currency)=3 AND currency=upper(currency) AND currency NOT GLOB '*[^A-Z]*'),
 minor_unit INTEGER NOT NULL CHECK(minor_unit BETWEEN 0 AND 4),
 amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0), amount_jpy INTEGER CHECK(amount_jpy >= 0),
 conversion_status TEXT NOT NULL CHECK(conversion_status IN ('unconverted','estimated','final')),
 description TEXT NOT NULL DEFAULT '', refund_of TEXT REFERENCES transactions(id),
 FOREIGN KEY(category_id,category_kind) REFERENCES categories(id,kind),
 CHECK((kind='income' AND category_kind='income') OR (kind!='income' AND category_kind='expense')),
 CHECK((kind='refund') = (refund_of IS NOT NULL)), CHECK(refund_of IS NULL OR refund_of != id),
 CHECK((conversion_status='unconverted') = (amount_jpy IS NULL)),
 CHECK(currency!='JPY' OR (minor_unit=0 AND amount_jpy IS NOT NULL AND amount_jpy=amount_minor AND conversion_status='final'))
) STRICT;
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS transactions_trip ON transactions(trip_id);
CREATE TABLE IF NOT EXISTS budgets (
 id TEXT PRIMARY KEY, month TEXT, trip_id TEXT REFERENCES trips(id), total_jpy INTEGER NOT NULL CHECK(total_jpy>=0),
 CHECK((month IS NULL) != (trip_id IS NULL)),
 CHECK(month IS NULL OR (length(month)=7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12')),
 UNIQUE(month), UNIQUE(trip_id)
) STRICT;
CREATE TABLE IF NOT EXISTS budget_allocations (
 budget_id TEXT NOT NULL REFERENCES budgets(id), category_id TEXT NOT NULL,
 category_kind TEXT NOT NULL DEFAULT 'expense' CHECK(category_kind='expense'),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy>=0), PRIMARY KEY(budget_id,category_id),
 FOREIGN KEY(category_id,category_kind) REFERENCES categories(id,kind)
) STRICT;
CREATE TABLE IF NOT EXISTS food_reviews (
 id TEXT PRIMARY KEY, place_id TEXT REFERENCES places(id), activity_id TEXT REFERENCES activities(id),
 transaction_id TEXT REFERENCES transactions(id), menu_item TEXT NOT NULL, observed_store_name TEXT,
 rating INTEGER CHECK(rating BETWEEN 1 AND 5), rank_position INTEGER CHECK(rank_position>0),
 prefecture TEXT, city TEXT, observed_price_jpy INTEGER CHECK(observed_price_jpy>=0)
) STRICT;
CREATE TABLE IF NOT EXISTS attachments (
 id TEXT PRIMARY KEY, storage_location TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('photo','receipt')),
 media_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size>=0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 caption TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS activity_attachments (
 activity_id TEXT NOT NULL REFERENCES activities(id), attachment_id TEXT NOT NULL REFERENCES attachments(id),
 PRIMARY KEY(activity_id,attachment_id)
) STRICT;
CREATE TABLE IF NOT EXISTS transaction_attachments (
 transaction_id TEXT NOT NULL REFERENCES transactions(id), attachment_id TEXT NOT NULL REFERENCES attachments(id),
 PRIMARY KEY(transaction_id,attachment_id)
) STRICT;
CREATE TABLE IF NOT EXISTS public_entries (
 id TEXT PRIMARY KEY, activity_id TEXT NOT NULL UNIQUE REFERENCES activities(id),
 date TEXT NOT NULL, place_name TEXT, memo TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published'))
) STRICT;
CREATE TABLE IF NOT EXISTS public_photos (
 id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES public_entries(id) ON DELETE CASCADE,
 png BLOB NOT NULL, sha256 TEXT NOT NULL, caption TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS import_batches (
 id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, source_project TEXT NOT NULL, read_time TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS source_records (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(id), source_database TEXT NOT NULL,
 source_path TEXT NOT NULL, source_id TEXT NOT NULL, raw_json TEXT NOT NULL, sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('converted','matched','needs_review','preserved')),
 review_reason TEXT, UNIQUE(batch_id,source_database,source_path)
) STRICT;
CREATE TABLE IF NOT EXISTS source_targets (
 source_id TEXT NOT NULL REFERENCES source_records(id),
 activity_id TEXT REFERENCES activities(id), transaction_id TEXT REFERENCES transactions(id),
 category_id TEXT REFERENCES categories(id), food_review_id TEXT REFERENCES food_reviews(id),
 CHECK((activity_id IS NOT NULL)+(transaction_id IS NOT NULL)+(category_id IS NOT NULL)+(food_review_id IS NOT NULL)=1)
) STRICT;
CREATE TABLE IF NOT EXISTS category_aliases (
 source_id TEXT NOT NULL REFERENCES source_records(id), original_id TEXT NOT NULL, original_label TEXT NOT NULL,
 category_id TEXT NOT NULL REFERENCES categories(id), PRIMARY KEY(source_id,category_id)
) STRICT;

CREATE TRIGGER IF NOT EXISTS transaction_trip_insert BEFORE INSERT ON transactions
WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM activities WHERE id=NEW.activity_id AND trip_id IS NEW.trip_id)
BEGIN SELECT RAISE(ABORT,'activity and transaction must belong to the same trip'); END;
CREATE TRIGGER IF NOT EXISTS transaction_trip_update BEFORE UPDATE ON transactions
WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM activities WHERE id=NEW.activity_id AND trip_id IS NEW.trip_id)
BEGIN SELECT RAISE(ABORT,'activity and transaction must belong to the same trip'); END;
CREATE TRIGGER IF NOT EXISTS activity_trip_update AFTER UPDATE OF trip_id ON activities
BEGIN UPDATE transactions SET trip_id=NEW.trip_id WHERE activity_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS refund_insert BEFORE INSERT ON transactions WHEN NEW.kind='refund'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.refund_of AND kind='expense'
 AND currency=NEW.currency AND minor_unit=NEW.minor_unit AND category_id=NEW.category_id AND trip_id IS NEW.trip_id)
 THEN RAISE(ABORT,'refund must reference an expense in the same currency, category and trip') END;
 SELECT CASE WHEN NEW.amount_minor + COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE refund_of=NEW.refund_of),0)
 > (SELECT amount_minor FROM transactions WHERE id=NEW.refund_of) THEN RAISE(ABORT,'refund exceeds expense') END;
END;
-- Financial corrections use replacement records/new valuation workflow; refunds cannot be silently rewritten.
CREATE TRIGGER IF NOT EXISTS refund_update BEFORE UPDATE ON transactions
WHEN (OLD.kind='refund' OR EXISTS(SELECT 1 FROM transactions WHERE refund_of=OLD.id))
 AND (NEW.kind!=OLD.kind OR NEW.refund_of IS NOT OLD.refund_of OR NEW.currency!=OLD.currency
 OR NEW.minor_unit!=OLD.minor_unit OR NEW.amount_minor!=OLD.amount_minor OR NEW.category_id!=OLD.category_id)
BEGIN SELECT RAISE(ABORT,'refund relationship is immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_convert_to_refund BEFORE UPDATE OF kind ON transactions
WHEN NEW.kind='refund' AND OLD.kind!='refund'
BEGIN SELECT RAISE(ABORT,'create a separate refund'); END;
CREATE TRIGGER IF NOT EXISTS final_valuation BEFORE UPDATE ON transactions
WHEN OLD.conversion_status='final' AND (NEW.amount_jpy IS NOT OLD.amount_jpy OR NEW.conversion_status!='final'
 OR NEW.currency!=OLD.currency OR NEW.minor_unit!=OLD.minor_unit OR NEW.amount_minor!=OLD.amount_minor)
BEGIN SELECT RAISE(ABORT,'final valuation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS allocation_insert BEFORE INSERT ON budget_allocations
WHEN NEW.amount_jpy + COALESCE((SELECT SUM(amount_jpy) FROM budget_allocations WHERE budget_id=NEW.budget_id),0)
 > (SELECT total_jpy FROM budgets WHERE id=NEW.budget_id)
BEGIN SELECT RAISE(ABORT,'allocations exceed total budget'); END;
CREATE TRIGGER IF NOT EXISTS allocation_update BEFORE UPDATE ON budget_allocations
WHEN NEW.amount_jpy + COALESCE((SELECT SUM(amount_jpy) FROM budget_allocations WHERE budget_id=NEW.budget_id
 AND NOT(budget_id=OLD.budget_id AND category_id=OLD.category_id)),0) > (SELECT total_jpy FROM budgets WHERE id=NEW.budget_id)
BEGIN SELECT RAISE(ABORT,'allocations exceed total budget'); END;
CREATE TRIGGER IF NOT EXISTS budget_reduce BEFORE UPDATE OF total_jpy ON budgets
WHEN NEW.total_jpy < COALESCE((SELECT SUM(amount_jpy) FROM budget_allocations WHERE budget_id=NEW.id),0)
BEGIN SELECT RAISE(ABORT,'total below allocations'); END;
