"""Compare additive 0011..latest upgrades with fresh initialization; never remote D1."""
from pathlib import Path
import sqlite3,re
root=Path(__file__).resolve().parents[2]
base=(root/'data_model/schema.sql').read_text()
extra=(root/'cloudflare/schema-extra.sql').read_text()
anchor='-- Private foreground GPS samples; independent from activities and public snapshots.'
assert extra.count(anchor)==1, 'Initial schema boundary must be explicit'
old=extra.split(anchor)[0]
files=sorted(p for p in (root/'cloudflare/migrations').glob('[0-9][0-9][0-9][0-9]-*.sql') if not p.name.endswith('.local.sql') and int(p.name.split('-')[0])>=11)
assert [p.name.split('-')[0] for p in files]==['0011','0012','0013','0014','0015','0016']
upgrade=sqlite3.connect(':memory:');fresh=sqlite3.connect(':memory:')
for db in [upgrade,fresh]:db.execute('PRAGMA foreign_keys=ON')
upgrade.executescript(base+old)
upgrade.execute("INSERT INTO users(id,email,display_name,handle,created_at) VALUES('kept','kept@example.invalid','kept','kept','2026-09-20T00:00:00Z')");upgrade.commit()
def seed_out_of_order(db):
 """Reproduce production: 0015 assigned sequence in insertion order, not by date."""
 db.execute("INSERT INTO categories(id,kind,name,user_id) VALUES('c1','activity','cat','kept')")
 rows=[('a','2025-12-07T10:00:00Z','2025-12-07'),('b','2025-04-10T10:00:00Z','2025-04-10'),
       ('c','2025-11-21T10:00:00Z','2025-11-21'),('d','2025-04-17T10:00:00Z','2025-04-17')]
 for key,occurred,date in rows:
  db.execute("INSERT INTO activities(id,occurred_at,timezone,timezone_basis,category_id,category_kind,user_id) VALUES(?,?,'Asia/Tokyo','recorded','c1','activity','kept')",(key,occurred))
  db.execute("INSERT INTO public_entries(id,activity_id,date,memo,status,user_id) VALUES(?,?,?,'','published','kept')",('e-'+key,key,date))
  db.execute("INSERT INTO public_entry_sequence(entry_id,author_user_id) VALUES(?,'kept')",('e-'+key,))
 db.commit()
 order=[r[0] for r in db.execute('SELECT entry_id FROM public_entry_sequence ORDER BY seq')]
 assert order==['e-a','e-b','e-c','e-d'], 'fixture must start in insertion order'

for p in files:
 upgrade.executescript(p.read_text())
 if p.name.startswith('0011'):
  upgrade.execute("INSERT INTO location_samples VALUES('kept','one','client','capture','segment','2026-09-20T00:00:00Z','2026-09-20T00:00:00Z',0,0,1)");upgrade.commit()
 if p.name.startswith('0015'):
  seed_out_of_order(upgrade)
fresh.executescript(base+extra)
def schema(db):
 return [(t,n,tn,re.sub(r'\s+',' ',sql).strip()) for t,n,tn,sql in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")]
assert schema(upgrade)==schema(fresh), 'Upgrade and fresh initialization differ'
assert upgrade.execute("SELECT email FROM users WHERE id='kept'").fetchone()==('kept@example.invalid',)
assert upgrade.execute('SELECT id FROM location_samples').fetchall()==[('one',)]
assert upgrade.execute('PRAGMA foreign_key_check').fetchall()==[]
assert {r[1] for r in upgrade.execute('PRAGMA table_info(public_read_cursors)')}=={'viewer_user_id','author_user_id','last_seen_seq','last_seen_entry_id','updated_at'}
replayed=[(e,d) for e,d in upgrade.execute('SELECT s.entry_id,p.date FROM public_entry_sequence s JOIN public_entries p ON p.id=s.entry_id ORDER BY s.seq')]
assert [d for _,d in replayed]==sorted(d for _,d in replayed), f'0016 must renumber into date order, got {replayed}'
assert [e for e,_ in replayed]==['e-b','e-d','e-c','e-a'], replayed
assert [r[0] for r in upgrade.execute('SELECT seq FROM public_entry_sequence ORDER BY seq')]==[1,2,3,4], 'sequence must be contiguous from 1'
upgrade.execute("INSERT INTO activities(id,occurred_at,timezone,timezone_basis,category_id,category_kind,user_id) VALUES('later','2025-05-01T10:00:00Z','Asia/Tokyo','recorded','c1','activity','kept')")
upgrade.execute("INSERT INTO public_entries(id,activity_id,date,memo,status,user_id) VALUES('e-later','later','2025-05-01','','published','kept')")
upgrade.execute("INSERT INTO public_entry_sequence(entry_id,author_user_id) VALUES('e-later','kept')")
assert upgrade.execute("SELECT seq FROM public_entry_sequence WHERE entry_id='e-later'").fetchone()[0]>4, 'entries published later must keep taking higher numbers, not slot into their date'
print('PASS: existing DB + 0011..0016 == fresh; users/GPS kept; foreign keys valid')
print('PASS: 0016 renumbers imported history into date order and keeps AUTOINCREMENT ahead')
print('0012/0015/0016 are apply-once changes. Production migration ledger remains a separate check.')
