"""Offline reference implementation. No network access or production credentials."""
from __future__ import annotations

import argparse
import base64
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import struct
import zlib

SCHEMA = Path(__file__).with_name('schema.sql')
JST = timezone(timedelta(hours=9))


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def stable_id(*parts):
    return digest(canonical(parts).encode())


def connect(path=':memory:'):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript(SCHEMA.read_text(encoding='utf-8'))
    return db


def instant(value):
    if not isinstance(value, str):
        raise ValueError('timestamp must be an ISO string')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timestamp must contain an offset')
    return result


def utc(value):
    return instant(value).astimezone(timezone.utc).isoformat()


def rating(value):
    if value is None or value == '':
        return None
    if isinstance(value, str) and re.fullmatch('★{1,5}', value):
        return len(value)
    if isinstance(value, str) and re.fullmatch('[1-5]', value):
        return int(value)
    if type(value) is int and 1 <= value <= 5:
        return value
    raise ValueError('rating must be null or 1..5')


def put(db, table, **values):
    # Table/field names are internal constants, never CLI input.
    db.execute(f'INSERT INTO {table} ({",".join(values)}) VALUES ({",".join("?" for _ in values)})', tuple(values.values()))


def add_activity(db, *, id, category_id, occurred_at, timezone_name='Asia/Tokyo',
                 timezone_basis='recorded', trip_id=None, **fields):
    if timezone_name != 'Asia/Tokyo':
        from zoneinfo import ZoneInfo
        ZoneInfo(timezone_name)  # Reject unknown zones; install tzdata if OS lacks the IANA database.
    put(db, 'activities', id=id, category_id=category_id, occurred_at=utc(occurred_at),
        timezone=timezone_name, timezone_basis=timezone_basis, trip_id=trip_id, **fields)


def add_transaction(db, *, id, category_id, occurred_at, amount_minor, currency='JPY',
                    minor_unit=0, amount_jpy=None, conversion_status=None, kind='expense',
                    activity_id=None, trip_id=None, refund_of=None, description=''):
    if type(amount_minor) is not int or (amount_jpy is not None and type(amount_jpy) is not int):
        raise ValueError('amounts must be integer minor units')
    if activity_id is not None:
        activity = db.execute('SELECT trip_id FROM activities WHERE id=?', (activity_id,)).fetchone()
        if not activity:
            raise ValueError('unknown activity')
        if trip_id is not None and trip_id != activity['trip_id']:
            raise ValueError('trip differs from activity')
        trip_id = activity['trip_id']
    if currency == 'JPY':
        if amount_jpy is not None and amount_jpy != amount_minor:
            raise ValueError('JPY conversion differs from original amount')
        amount_jpy, conversion_status = amount_minor, 'final'
    elif conversion_status is None:
        conversion_status = 'unconverted' if amount_jpy is None else 'estimated'
    put(db, 'transactions', id=id, category_id=category_id,
        category_kind='income' if kind == 'income' else 'expense', occurred_at=utc(occurred_at),
        amount_minor=amount_minor, currency=currency, minor_unit=minor_unit, amount_jpy=amount_jpy,
        conversion_status=conversion_status, kind=kind, activity_id=activity_id, trip_id=trip_id,
        refund_of=refund_of, description=description)


def move_activity(db, activity_id, trip_id):
    """Move activity and linked finance together, preserving refund trip consistency."""
    with db:
        db.execute('UPDATE activities SET trip_id=? WHERE id=?', (trip_id, activity_id))
        validate(db)


def totals(db, *, month=None, trip_id=None, category_id=None):
    if month is not None and not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('month must be YYYY-MM')
    result = dict(expense_jpy=0, income_jpy=0, refund_jpy=0, net_expense_jpy=0,
                  net_cashflow_jpy=0, unconverted_count=0, estimated_count=0)
    for row in db.execute('SELECT * FROM transactions'):
        if month and instant(row['occurred_at']).astimezone(JST).strftime('%Y-%m') != month:
            continue
        if trip_id is not None and row['trip_id'] != trip_id:
            continue
        if category_id is not None and row['category_id'] != category_id:
            continue
        if row['amount_jpy'] is None:
            result['unconverted_count'] += 1
            continue
        result['estimated_count'] += row['conversion_status'] == 'estimated'
        result[row['kind'] + '_jpy'] += row['amount_jpy']
    result['net_expense_jpy'] = result['expense_jpy'] - result['refund_jpy']
    result['net_cashflow_jpy'] = result['income_jpy'] - result['net_expense_jpy']
    return result


def budget_status(db, budget_id):
    budget = db.execute('SELECT * FROM budgets WHERE id=?', (budget_id,)).fetchone()
    if budget is None:
        raise ValueError('unknown budget')
    scope = dict(month=budget['month'], trip_id=budget['trip_id'])
    summary = totals(db, **scope)
    allocations = []
    for row in db.execute('SELECT * FROM budget_allocations WHERE budget_id=?', (budget_id,)):
        used = totals(db, category_id=row['category_id'], **scope)
        allocations.append(dict(category_id=row['category_id'], budget_jpy=row['amount_jpy'],
                                remaining_jpy=row['amount_jpy'] - used['net_expense_jpy'], **used))
    return dict(total_jpy=budget['total_jpy'], remaining_jpy=budget['total_jpy'] - summary['net_expense_jpy'],
                allocations=allocations, **summary)


def clean_png(data):
    """Keep only core PNG chunks; discard EXIF/text/time/GPS-bearing ancillary metadata."""
    signature = b'\x89PNG\r\n\x1a\n'
    if not data.startswith(signature):
        raise ValueError('public photos must be static PNG; convert other formats locally first')
    output, pos, kinds = bytearray(signature), 8, []
    while pos < len(data):
        if pos + 12 > len(data):
            raise ValueError('truncated PNG')
        length = struct.unpack('>I', data[pos:pos+4])[0]
        end = pos + length + 12
        if end > len(data):
            raise ValueError('truncated PNG chunk')
        kind, body = data[pos+4:pos+8], data[pos+8:pos+8+length]
        crc = struct.unpack('>I', data[pos+8+length:end])[0]
        if zlib.crc32(kind+body) & 0xffffffff != crc:
            raise ValueError('PNG checksum mismatch')
        if kind in (b'acTL', b'fcTL', b'fdAT'):
            raise ValueError('animated PNG is unsupported')
        if not kinds and (kind != b'IHDR' or length != 13):
            raise ValueError('invalid PNG header')
        if kind in (b'IHDR', b'PLTE', b'IDAT', b'IEND', b'tRNS'):
            output.extend(data[pos:end])
        elif kind[0] & 32 == 0:
            raise ValueError('unknown critical PNG chunk')
        kinds.append(kind)
        pos = end
        if kind == b'IEND':
            if length or pos != len(data):
                raise ValueError('invalid PNG ending')
            break
    if kinds.count(b'IHDR') != 1 or b'IDAT' not in kinds or not kinds or kinds[-1] != b'IEND':
        raise ValueError('incomplete PNG')
    return bytes(output)


def prepare_public_entry(db, *, id, activity_id, date, memo, place_name=None, photo_ids=()):
    """Explicit selected text only. Never copy a private activity memo automatically."""
    datetime.strptime(date, '%Y-%m-%d')
    with db:
        put(db, 'public_entries', id=id, activity_id=activity_id, date=date, memo=memo, place_name=place_name)
        for photo_id in photo_ids:
            row = db.execute('SELECT a.* FROM attachments a JOIN activity_attachments l ON a.id=l.attachment_id '
                             'WHERE a.id=? AND l.activity_id=?', (photo_id, activity_id)).fetchone()
            if row is None or row['purpose'] != 'photo' or row['media_type'] != 'image/png':
                raise ValueError('only linked travel PNG photos may be shared; receipts are private')
            data = Path(row['storage_location']).read_bytes()
            if len(data) != row['byte_size'] or digest(data) != row['sha256']:
                raise ValueError('attachment changed since registration')
            png = clean_png(data)
            put(db, 'public_photos', id=stable_id(id, photo_id), entry_id=id, png=png, sha256=digest(png))


def register_attachment(db, *, id, path, purpose, media_type, caption='', activity_ids=(), transaction_ids=()):
    path = private_output(path)
    data = path.read_bytes()
    with db:
        put(db, 'attachments', id=id, storage_location=str(path), purpose=purpose,
            media_type=media_type, byte_size=len(data), sha256=digest(data), caption=caption)
        for activity_id in activity_ids:
            put(db, 'activity_attachments', activity_id=activity_id, attachment_id=id)
        for transaction_id in transaction_ids:
            put(db, 'transaction_attachments', transaction_id=transaction_id, attachment_id=id)


def set_public_status(db, entry_id, *, published):
    with db:
        validate(db)
        cursor = db.execute('UPDATE public_entries SET status=? WHERE id=?',
                            ('published' if published else 'draft', entry_id))
        if cursor.rowcount != 1:
            raise ValueError('unknown public entry')


def public_feed(db):
    # Allowlist serialization from snapshots only: no joins to private tables.
    entries = []
    for row in db.execute("SELECT id,date,place_name,memo FROM public_entries WHERE status='published' ORDER BY date,id"):
        photos = [dict(id=p['id'], caption=p['caption'], data_url='data:image/png;base64,' +
                       base64.b64encode(p['png']).decode('ascii')) for p in db.execute(
                           'SELECT id,caption,png FROM public_photos WHERE entry_id=? ORDER BY id', (row['id'],))]
        entries.append(dict(row) | {'photos': photos})
    return entries


def fs_value(value):
    if 'nullValue' in value:
        return None
    for key in ('stringValue', 'timestampValue', 'booleanValue'):
        if key in value:
            return value[key]
    if 'integerValue' in value:
        return int(value['integerValue'])
    if 'doubleValue' in value:
        return float(value['doubleValue'])
    raise ValueError('unsupported Firestore field type; raw record retained for review')


def signature(log):
    return canonical([utc(log['timestamp']), float(log['lat']), float(log['lng']), log.get('memo'),
                      None if log.get('amount') is None else float(log['amount']), log.get('amount_category')])


def source_record(db, batch_id, database, path, raw, status='preserved', reason=None):
    serialized = canonical(raw)
    id = stable_id(batch_id, database, path)
    put(db, 'source_records', id=id, batch_id=batch_id, source_database=database,
        source_path=path, source_id=path.rsplit('/', 1)[-1], raw_json=serialized,
        sha256=digest(serialized.encode()), status=status, review_reason=reason)
    return id


def link(db, source_id, field, target):
    put(db, 'source_targets', source_id=source_id, **{field: target})


def review(db, source_id, reason):
    db.execute("UPDATE source_records SET status='needs_review', review_reason=? WHERE id=?", (reason, source_id))


def read_backup(folder):
    folder = Path(folder)
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    verified = {}
    for item in manifest['files']:
        name = item['name']
        if Path(name).name != name or name in verified:
            raise ValueError('invalid/duplicate manifest file name')
        content = (folder / name).read_bytes()
        if len(content) != item['bytes'] or digest(content) != item['sha256']:
            raise ValueError('backup checksum mismatch: ' + name)
        verified[name] = json.loads(content)
    fs, rt = verified['firestore-documents.json'], verified['realtime-database.json']
    if len(fs['documents']) != manifest['firestoreDocuments'] or fs['project'] != manifest['project']:
        raise ValueError('backup document count/project mismatch')
    if fs.get('readTime') != manifest['readTime']:
        raise ValueError('backup snapshot mismatch')
    counts = Counter(doc['name'].rsplit('/', 1)[0] for doc in fs['documents'])
    if dict(counts) != {c['path']: c['documents'] for c in manifest['collections']}:
        raise ValueError('collection inventory mismatch')
    for c in manifest['collections']:
        if c['documents'] != c['serverCount']:
            raise ValueError('collection server count mismatch')
    for key, count in manifest['realtimeTopLevelCounts'].items():
        if len(rt.get(key, {})) != count:
            raise ValueError('RTDB count mismatch')
    return manifest, fs, rt


def import_backup(db, folder):
    manifest, fs, rt = read_backup(folder)
    batch = stable_id(manifest)
    if db.execute('SELECT 1 FROM import_batches WHERE id=?', (batch,)).fetchone():
        return validate(db)
    if db.execute('SELECT COUNT(*) FROM import_batches').fetchone()[0]:
        raise ValueError('use a fresh staging database for a different snapshot')
    with db:
        put(db, 'import_batches', id=batch, manifest_json=canonical(manifest),
            source_project=fs['project'], read_time=fs['readTime'])
        # Root records preserve export priorities, unknown keys, and all top-level structure.
        source_record(db, batch, 'rtdb', '/', rt)
        source_record(db, batch, 'firestore-export', '/', {k: v for k, v in fs.items() if k != 'documents'})
        categories, logs = {}, []
        for doc in fs['documents']:
            path = doc['name'].split('/documents/', 1)[1]
            sid = source_record(db, batch, fs['database'], path, doc)
            try:
                fields = {k: fs_value(v) for k, v in doc.get('fields', {}).items()}
                collection, original_id = path.split('/') if path.count('/') == 1 else ('', '')
                if collection == 'categories':
                    ids = {}
                    for kind in ('activity', 'expense'):
                        cid = stable_id(fs['project'], path, kind)
                        put(db, 'categories', id=cid, kind=kind, name=fields['name'],
                            color=fields.get('color'), sort_order=fields.get('order', 0))
                        put(db, 'category_aliases', source_id=sid, original_id=original_id,
                            original_label=fields['name'], category_id=cid)
                        link(db, sid, 'category_id', cid)
                        ids[kind] = cid
                    categories[original_id] = (fields['name'], ids)
                    db.execute("UPDATE source_records SET status='converted' WHERE id=?", (sid,))
                elif collection == 'logs':
                    logs.append((path, sid, fields))
                elif collection != 'meta':
                    review(db, sid, 'unrecognized document; preserved without conversion')
            except (KeyError, ValueError, TypeError) as exc:
                review(db, sid, str(exc))
        new_matches = defaultdict(list)
        for path, sid, log in logs:
            db.execute('SAVEPOINT log_conversion')
            try:
                label = log['amount_category']
                candidates = [value[1] for key, value in categories.items() if key == label]
                if not candidates:
                    candidates = [value[1] for value in categories.values() if value[0] == label]
                if len(candidates) != 1:
                    raise ValueError('category alias is missing or ambiguous')
                ids = candidates[0]
                aid = stable_id(fs['project'], path)
                add_activity(db, id=aid, category_id=ids['activity'], occurred_at=log['timestamp'],
                             timezone_basis='assumed', memo=log.get('memo', ''),
                             observed_place_name=log.get('locationName'), latitude=log['lat'], longitude=log['lng'],
                             rating=rating(log.get('stars')))
                link(db, sid, 'activity_id', aid)
                if log.get('amount') is not None:
                    tid = stable_id(aid, 'expense')
                    add_transaction(db, id=tid, category_id=ids['expense'], occurred_at=log['timestamp'],
                                    amount_minor=log['amount'], activity_id=aid, description=log.get('memo', ''))
                    link(db, sid, 'transaction_id', tid)
                sig = signature(log)
                db.execute("UPDATE source_records SET status='converted' WHERE id=?", (sid,))
                new_matches[sig].append(aid)
                db.execute('RELEASE log_conversion')
            except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as exc:
                db.execute('ROLLBACK TO log_conversion')
                db.execute('RELEASE log_conversion')
                review(db, sid, str(exc))
        old_signatures = {}
        for key, log in rt.get('logs', {}).items():
            try:
                old_signatures[key] = signature(log)
            except (ValueError, KeyError, TypeError):
                pass
        old_counts = Counter(old_signatures.values())
        for key, log in rt.get('logs', {}).items():
            sid = source_record(db, batch, 'rtdb', 'logs/' + key, log)
            sig = old_signatures.get(key)
            candidates = new_matches.get(sig, [])
            if len(candidates) == 1 and old_counts[sig] == 1:
                aid = candidates[0]
                link(db, sid, 'activity_id', aid)
                for row in db.execute('SELECT id FROM transactions WHERE activity_id=?', (aid,)).fetchall():
                    link(db, sid, 'transaction_id', row['id'])
                db.execute("UPDATE source_records SET status='matched' WHERE id=?", (sid,))
            else:
                review(db, sid, 'no unique six-field match; candidates=' + canonical(candidates))
        for key, raw in rt.get('foodRank', {}).items():
            sid = source_record(db, batch, 'rtdb', 'foodRank/' + key, raw)
            fid = stable_id('rtdb', 'foodRank', key)
            try:
                put(db, 'food_reviews', id=fid, menu_item=raw['menue'], observed_store_name=raw.get('store'),
                    rank_position=raw.get('rank'), prefecture=raw.get('prefecture'), city=raw.get('city'),
                    observed_price_jpy=raw.get('amount'))
                link(db, sid, 'food_review_id', fid)
                review(db, sid, 'food review retained; relation to expense/place needs confirmation')
            except (KeyError, TypeError, sqlite3.IntegrityError) as exc:
                review(db, sid, str(exc))
        report = validate(db)
    return report


def validate(db):
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('database integrity check failed')
    errors = db.execute('SELECT t.id FROM transactions t JOIN activities a ON a.id=t.activity_id '
                        'WHERE t.trip_id IS NOT a.trip_id').fetchall()
    if errors:
        raise ValueError('transaction/activity trip mismatch')
    for row in db.execute('SELECT occurred_at FROM activities UNION ALL SELECT occurred_at FROM transactions'):
        instant(row[0])
    for row in db.execute("SELECT r.* FROM transactions r JOIN transactions e ON e.id=r.refund_of WHERE r.kind='refund'"):
        expense = db.execute('SELECT * FROM transactions WHERE id=?', (row['refund_of'],)).fetchone()
        if expense['kind'] != 'expense' or any(row[k] != expense[k] for k in ('currency','minor_unit','category_id','trip_id')):
            raise ValueError('invalid refund relationship')
    for row in db.execute('SELECT * FROM source_records'):
        if digest(row['raw_json'].encode()) != row['sha256']:
            raise ValueError('source record hash mismatch')
        json.loads(row['raw_json'])
        if row['status'] in ('converted', 'matched') and not db.execute(
                'SELECT 1 FROM source_targets WHERE source_id=?', (row['id'],)).fetchone():
            raise ValueError('converted source has no target')
    for batch in db.execute('SELECT * FROM import_batches'):
        manifest = json.loads(batch['manifest_json'])
        count = db.execute("SELECT COUNT(*) FROM source_records WHERE batch_id=? AND source_database NOT IN ('rtdb','firestore-export')", (batch['id'],)).fetchone()[0]
        if count != manifest['firestoreDocuments']:
            raise ValueError('not all Firestore originals accounted for')
        for name in ('logs', 'foodRank'):
            actual = db.execute("SELECT COUNT(*) FROM source_records WHERE batch_id=? AND source_database='rtdb' AND source_path LIKE ?", (batch['id'], name+'/%')).fetchone()[0]
            if actual != manifest['realtimeTopLevelCounts'].get(name, 0):
                raise ValueError('not all RTDB originals accounted for')
    for photo in db.execute('SELECT * FROM public_photos'):
        if clean_png(photo['png']) != photo['png'] or digest(photo['png']) != photo['sha256']:
            raise ValueError('public photo is not sanitized')
    tables = ('trips','activities','places','transactions','categories','budgets','budget_allocations',
              'food_reviews','attachments','activity_attachments','transaction_attachments','public_entries',
              'public_photos','import_batches','source_records','source_targets','category_aliases')
    return dict(counts={table: db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in tables},
                source_statuses={row[0]: row[1] for row in db.execute('SELECT status,COUNT(*) FROM source_records GROUP BY status')},
                zero_amount_transactions=db.execute('SELECT COUNT(*) FROM transactions WHERE amount_minor=0').fetchone()[0],
                activities_without_transaction=db.execute('SELECT COUNT(*) FROM activities a WHERE NOT EXISTS(SELECT 1 FROM transactions t WHERE t.activity_id=a.id)').fetchone()[0],
                totals=totals(db), public_entry_count=len(public_feed(db)))


def database_fingerprint(db):
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    result = {}
    for table in tables:
        rows = [canonical([{'blob': base64.b64encode(v).decode()} if isinstance(v, bytes) else v for v in row])
                for row in db.execute(f'SELECT * FROM "{table}"')]
        result[table] = sorted(rows)
    return digest(canonical(result).encode())


def verify_against_backup(db, folder):
    """Read back each source and each converted Firestore log, independent of import counts."""
    manifest, fs, rt = read_backup(folder)
    batch = stable_id(manifest)
    expected = [(fs['database'], doc['name'].split('/documents/', 1)[1], doc) for doc in fs['documents']]
    expected += [('rtdb', '/', rt), ('firestore-export', '/', {k: v for k, v in fs.items() if k != 'documents'})]
    for collection in ('logs', 'foodRank'):
        expected += [('rtdb', collection+'/'+key, raw) for key, raw in rt.get(collection, {}).items()]
    if db.execute('SELECT COUNT(*) FROM source_records WHERE batch_id=?', (batch,)).fetchone()[0] != len(expected):
        raise ValueError('source inventory differs from backup')
    converted_logs = 0
    original_total = 0
    for database, path, raw in expected:
        source = db.execute('SELECT * FROM source_records WHERE batch_id=? AND source_database=? AND source_path=?',
                            (batch, database, path)).fetchone()
        if source is None or source['raw_json'] != canonical(raw):
            raise ValueError('original record differs: ' + path)
        if database != fs['database'] or not path.startswith('logs/') or source['status'] != 'converted':
            continue
        original = {k: fs_value(v) for k, v in raw['fields'].items()}
        activities = db.execute('SELECT a.* FROM activities a JOIN source_targets s ON s.activity_id=a.id WHERE s.source_id=?', (source['id'],)).fetchall()
        if len(activities) != 1:
            raise ValueError('log must map to exactly one activity')
        activity = activities[0]
        comparisons = dict(occurred_at=utc(original['timestamp']), memo=original.get('memo',''),
                           latitude=original['lat'], longitude=original['lng'],
                           observed_place_name=original.get('locationName'), rating=rating(original.get('stars')))
        if any(activity[key] != value for key, value in comparisons.items()):
            raise ValueError('converted activity differs: ' + path)
        aliases = db.execute('SELECT original_id,original_label FROM category_aliases WHERE category_id=?', (activity['category_id'],)).fetchall()
        if not any(original['amount_category'] in tuple(row) for row in aliases):
            raise ValueError('category mapping differs: ' + path)
        transactions = db.execute('SELECT t.* FROM transactions t JOIN source_targets s ON s.transaction_id=t.id WHERE s.source_id=?', (source['id'],)).fetchall()
        amount = original.get('amount')
        if amount is None:
            if transactions:
                raise ValueError('missing amount became a transaction')
        else:
            if len(transactions) != 1 or any(transactions[0][key] != value for key, value in
                                           dict(activity_id=activity['id'], kind='expense', currency='JPY',
                                                amount_minor=amount, amount_jpy=amount,
                                                occurred_at=utc(original['timestamp'])).items()):
                raise ValueError('converted transaction differs: ' + path)
            original_total += amount
        converted_logs += 1
    return dict(source_records_compared=len(expected), converted_logs_compared=converted_logs,
                converted_original_total_jpy=original_total, **validate(db))


def restore_test(db, destination):
    destination = Path(destination)
    # Exclusive reservation prevents accidental overwrite of any existing database.
    with destination.open('xb'):
        pass
    with closing(sqlite3.connect(destination)) as restored:
        db.backup(restored)
        restored.row_factory = sqlite3.Row
        restored.execute('PRAGMA foreign_keys=ON')
        validate(restored)
        before, after = database_fingerprint(db), database_fingerprint(restored)
        if before != after:
            raise ValueError('restored content differs')
    return dict(restore_tested=True, fingerprint=before)


def private_output(path):
    """Never put private databases/exports under the checkout or hosting directories."""
    path = Path(path).resolve()
    root = Path(__file__).resolve().parents[1]
    if path.is_relative_to(root):
        raise ValueError('private output must be outside the repository')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('import', 'verify', 'restore-test', 'public-export'))
    parser.add_argument('--database', required=True)
    parser.add_argument('--backup')
    parser.add_argument('--output')
    args = parser.parse_args()
    db_path = private_output(args.database)
    if args.command != 'import' and not db_path.is_file():
        parser.error('database does not exist')
    if args.command == 'import' and not args.backup:
        parser.error('--backup is required')
    if args.command in ('restore-test', 'public-export') and not args.output:
        parser.error('--output is required')
    with closing(connect(db_path)) as db:
        if args.command == 'import':
            result = import_backup(db, args.backup)
        elif args.command == 'verify':
            result = verify_against_backup(db, args.backup) if args.backup else validate(db)
        elif args.command == 'restore-test':
            result = restore_test(db, private_output(args.output))
        else:
            validate(db)
            with private_output(args.output).open('x', encoding='utf-8') as output:
                json.dump(public_feed(db), output, ensure_ascii=False, indent=2)
            result = {'public_entries': len(public_feed(db))}
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
