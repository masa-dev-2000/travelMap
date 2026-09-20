"""Compare old -> 0011 -> 0012 and new initialization; keep users and existing GPS samples."""
from pathlib import Path
import sqlite3
root=Path(__file__).resolve().parents[2]
base=(root/'data_model/schema.sql').read_text()
extra=(root/'cloudflare/schema-extra.sql').read_text()
first=(root/'cloudflare/migrations/0011-location-samples.sql').read_text()
second=(root/'cloudflare/migrations/0012-location-handoff.sql').read_text()
assert extra.endswith(first+second), 'Cumulative schema must include both reviewed migrations'
old=extra[:-len(first+second)]
upgrade=sqlite3.connect(':memory:');fresh=sqlite3.connect(':memory:')
upgrade.executescript(base+old)
upgrade.execute("INSERT INTO users(id,email,display_name,handle,created_at) VALUES('kept','kept@example.invalid','kept','kept','2026-09-20T00:00:00Z')")
upgrade.commit();upgrade.executescript(first)
upgrade.execute("INSERT INTO location_samples VALUES('kept','one','client','capture','segment','2026-09-20T00:00:00Z','2026-09-20T00:00:00Z',0,0,1)")
upgrade.commit();upgrade.executescript(second)
fresh.executescript(base+extra)
schema=lambda db:db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
assert schema(upgrade)==schema(fresh), 'Upgrade and fresh initialization differ'
assert upgrade.execute("SELECT email FROM users WHERE id='kept'").fetchone()==('kept@example.invalid',)
assert upgrade.execute('SELECT id FROM location_samples').fetchall()==[('one',)]
assert upgrade.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS: old + 0011 + 0012 == fresh; user and sample retained; foreign keys valid')
print('0012 contains ALTER TABLE; apply once via migration tracking, never rerun blindly.')
