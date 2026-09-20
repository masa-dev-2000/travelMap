"""Local SQLite reproduction of PR8's published DDL and query predicates.
No network, production data or remote D1 writes. Uses the current migrations.
DDL source: cloudflare/migrations/0011-location-samples.sql @ 2256782.
Query source: cloudflare/src/location-api.ts @ the same commit.
"""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import json, sqlite3

PROJECT=Path(__file__).resolve().parents[2]
ROOT=PROJECT/'test-artifacts/indexes'
ROOT.mkdir(parents=True,exist_ok=True)
DDL=(PROJECT/'cloudflare/migrations/0011-location-samples.sql').read_text()
HANDOFF=(PROJECT/'cloudflare/migrations/0012-location-handoff.sql').read_text()
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.execute('CREATE TABLE users(id TEXT PRIMARY KEY) STRICT')
db.executescript(DDL+HANDOFF)
users=[f'u{i}' for i in range(5)]
db.executemany('INSERT INTO users VALUES(?)',[(u,) for u in users])
start=datetime(2026,1,1,tzinfo=timezone.utc)
def key(i): return f'00000000-0000-4000-8000-{i:012x}'
def stamp(i): return (start+timedelta(seconds=(i//3)*300)).isoformat(timespec='milliseconds').replace('+00:00','Z')
# Three records share a timestamp: exercise cursor ID tie-breaking.
db.executemany('INSERT INTO location_samples VALUES(?,?,?,?,?,?,?,?,?,?)',
 ((u,key(i),key(20001),key(20002),key(20003),stamp(i),stamp(i),35.,134.,10.) for u in users for i in range(20000)))
db.executemany('INSERT INTO location_capture_leases(user_id,client_id,capture_id,page_id,expires_at) VALUES(?,?,?,?,?)',[(u,key(20001),key(20002),key(20003),2000000000000) for u in users])
db.commit()
select='SELECT id,segment_id,captured_at,received_at,latitude,longitude,accuracy FROM location_samples WHERE user_id=? AND captured_at>=? AND captured_at<=?'
order=' ORDER BY captured_at DESC,id DESC LIMIT ?'
# First two forms reproduce the actual source SQL, after placeholder assembly.
first=select+order
original=select+' AND (captured_at<? OR (captured_at=? AND id<?))'+order
candidate=select+' AND (captured_at,id)<(?,?)'+order
base=('u0','2020-01-01T00:00:00.000Z','2030-01-01T00:00:00.000Z')
index_defs={t:[{'name':r[1],'unique':bool(r[2]),'origin':r[3], 'columns':[x[2] for x in db.execute(f'PRAGMA index_info("{r[1]}")')]} for r in db.execute(f'PRAGMA index_list({t})')] for t in ['location_samples','location_capture_leases']}
plans={}
def eqp(name,q,args):
 plans[name]=[row[3] for row in db.execute('EXPLAIN QUERY PLAN '+q,args)]
def count_ops(q,args):
 count=0
 def progress():
  nonlocal count
  count+=1
  return 0
 db.set_progress_handler(progress,1)
 try: rows=db.execute(q,args).fetchall()
 finally: db.set_progress_handler(None,0)
 return rows,count
# A cursor just after the newest 15,000 of the owner's 20,000 rows.
cursor=db.execute(first,base+(15000,)).fetchall()[-1]
ct,ci=cursor[2],cursor[0]
args_original=base+(ct,ct,ci,500)
args_candidate=base+(ct,ci,500)
args_bounded=(base[0],base[1],min(base[2],ct),ct,ct,ci,500)
eqp('first_page',first,base+(500,))
eqp('deep_page_current',original,args_original)
eqp('deep_page_tuple_only_candidate',candidate,args_candidate)
eqp('deep_page_bounded_candidate',original,args_bounded)
eqp('dedup_lookup','SELECT id,client_id,capture_id,segment_id,captured_at,latitude,longitude,accuracy FROM location_samples WHERE user_id=? AND id=?',('u0',key(1)))
eqp('delete_owned','DELETE FROM location_samples WHERE user_id=? AND id=?',('u0',key(1)))
eqp('lease_renew','UPDATE location_capture_leases SET expires_at=? WHERE user_id=? AND client_id=? AND capture_id=? AND page_id=? AND expires_at>?',(2000000000001,'u0',key(20001),key(20002),key(20003),1000000000000))
r1,n1=count_ops(original,args_original)
r2,n2=count_ops(candidate,args_candidate)
r3,n3=count_ops(original,args_bounded)
assert r1==r2==r3 and len(r1)==500
# Traverse whole result with proposed cursor; compare to authoritative query.
allrows=db.execute(first,base+(30000,)).fetchall()
seen=[]; cursor=None; pages=0
while True:
 if cursor is None: rows=db.execute(first,base+(500,)).fetchall()
 else: rows=db.execute(original,(base[0],base[1],min(base[2],cursor[2]),cursor[2],cursor[2],cursor[0],500)).fetchall()
 if not rows: break
 seen.extend(rows);cursor=rows[-1];pages+=1
assert seen==allrows and len({r[0] for r in seen})==20000
# Cursor boundary checks: same timestamp ties, bounds outside requested interval,
# another owner's rows, and several page sizes; predicates must remain equivalent.
boundary_checks=0
for user in ['u0','u4']:
 for low,high in [(0,19999),(500,15000)]:
  for cur in [0,1,499,500,501,10000,15000,19998,19999]:
   for size in [1,50,500]:
    args=(user,stamp(low),stamp(high))
    a=db.execute(original,args+(stamp(cur),stamp(cur),key(cur),size)).fetchall()
    b=db.execute(original,(args[0],args[1],min(args[2],stamp(cur)),stamp(cur),stamp(cur),key(cur),size)).fetchall()
    assert a==b
    boundary_checks+=1
report={'scope':'Local SQLite only; synthetic data; not Cloudflare D1 runtime or rows_read measurement',
 'sqlite_version':sqlite3.sqlite_version,'source_commit':'2256782143bda1d56a8819c15a645c2c112afd22',
 'data':{'users':5,'rows_per_user':20000,'total_samples':100000,'same_timestamp_group_size':3},
 'indexes':index_defs,'plans':plans,
 'deep_page':{'preceding_rows':15000,'returned':500,'results_identical':True,'current_vm_instructions':n1,'tuple_only_vm_instructions':n2,'bounded_upper_vm_instructions':n3,'note':'Tuple-only replacement did not improve this local query; retaining OR and binding upper time to min(requested_to,cursor_time) did.'},
 'boundary_equivalence_cases':boundary_checks,'pagination':{'pages':pages,'returned_rows':len(seen),'identical_to_full_order':True,'duplicate_ids':False},
 'queries':{'first':first,'current_cursor':original,'tuple_only_candidate':candidate,'chosen_candidate':original,'chosen_binding_change':'third placeholder = min(requested_to, cursor_date); remaining predicates unchanged'},
 'source_urls':['https://github.com/masa-dev-2000/travelMap/blob/2256782143bda1d56a8819c15a645c2c112afd22/cloudflare/migrations/0011-location-samples.sql','https://github.com/masa-dev-2000/travelMap/blob/2256782143bda1d56a8819c15a645c2c112afd22/cloudflare/src/location-api.ts']}
(ROOT/'index_check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
