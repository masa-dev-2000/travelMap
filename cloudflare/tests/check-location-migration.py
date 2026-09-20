"""Compare a populated old DB + new migration against cumulative fresh initialization."""
from pathlib import Path
import sqlite3
root=Path(__file__).resolve().parents[2]
base=(root/'data_model/schema.sql').read_text()
extra=(root/'cloudflare/schema-extra.sql').read_text()
migration=(root/'cloudflare/migrations/0011-location-samples.sql').read_text()
assert extra.endswith(migration), 'Cumulative schema must include the reviewed location migration'
old=extra[:-len(migration)]
upgrade=sqlite3.connect(':memory:');fresh=sqlite3.connect(':memory:')
upgrade.executescript(base+old)
upgrade.execute("INSERT INTO users(id,email,display_name,handle,created_at) VALUES('kept','kept@example.invalid','kept','kept','2026-09-20T00:00:00Z')")
upgrade.commit();upgrade.executescript(migration)
fresh.executescript(base+extra)
schema=lambda db:db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
assert schema(upgrade)==schema(fresh), 'Upgrade and fresh initialization differ'
assert upgrade.execute("SELECT email FROM users WHERE id='kept'").fetchone()==('kept@example.invalid',)
upgrade.executescript(migration)
assert schema(upgrade)==schema(fresh), 'Migration rerun changed the schema'
upgrade.close();fresh.close()
print('PASS: upgrade == fresh schema; existing user retained; rerun safe')
