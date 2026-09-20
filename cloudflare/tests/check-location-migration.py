"""Compare additive 0011..latest upgrades with fresh initialization; never remote D1."""
from pathlib import Path
import sqlite3,re
root=Path(__file__).resolve().parents[2]
base=(root/'data_model/schema.sql').read_text()
extra=(root/'cloudflare/schema-extra.sql').read_text()
anchor='-- Private foreground GPS samples; independent from activities and public snapshots.'
assert extra.count(anchor)==1, 'Initial schema boundary must be explicit'
old=extra.split(anchor)[0]
files=sorted(p for p in (root/'cloudflare/migrations').glob('*.sql') if int(p.name.split('-')[0])>=11)
assert [p.name.split('-')[0] for p in files]==['0011','0012','0013','0014','0015']
upgrade=sqlite3.connect(':memory:');fresh=sqlite3.connect(':memory:')
for db in [upgrade,fresh]:db.execute('PRAGMA foreign_keys=ON')
upgrade.executescript(base+old)
upgrade.execute("INSERT INTO users(id,email,display_name,handle,created_at) VALUES('kept','kept@example.invalid','kept','kept','2026-09-20T00:00:00Z')");upgrade.commit()
for p in files:
 upgrade.executescript(p.read_text())
 if p.name.startswith('0011'):
  upgrade.execute("INSERT INTO location_samples VALUES('kept','one','client','capture','segment','2026-09-20T00:00:00Z','2026-09-20T00:00:00Z',0,0,1)");upgrade.commit()
fresh.executescript(base+extra)
def schema(db):
 return [(t,n,tn,re.sub(r'\s+',' ',sql).strip()) for t,n,tn,sql in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")]
assert schema(upgrade)==schema(fresh), 'Upgrade and fresh initialization differ'
assert upgrade.execute("SELECT email FROM users WHERE id='kept'").fetchone()==('kept@example.invalid',)
assert upgrade.execute('SELECT id FROM location_samples').fetchall()==[('one',)]
assert upgrade.execute('PRAGMA foreign_key_check').fetchall()==[]
assert {r[1] for r in upgrade.execute('PRAGMA table_info(public_read_cursors)')}=={'viewer_user_id','author_user_id','last_seen_seq','last_seen_entry_id','updated_at'}
print('PASS: existing DB + 0011..0015 == fresh; users/GPS kept; foreign keys valid')
print('0012/0015 are apply-once changes. Production migration ledger remains a separate check.')
