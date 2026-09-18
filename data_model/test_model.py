import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
import zlib

from model import (add_activity, add_transaction, budget_status, canonical, clean_png, connect,
                   database_fingerprint, digest, import_backup, move_activity, prepare_public_entry,
                   private_output, public_feed, put, rating, register_attachment, restore_test,
                   set_public_status, totals, validate, verify_against_backup)


def png_chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)


PNG = (b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
       + png_chunk(b'tEXt', b'GPS\x00PRIVATE') + png_chunk(b'eXIf', b'PRIVATE EXIF')
       + png_chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + png_chunk(b'IEND', b''))


def backup_fixture(folder, *, duplicate_new=False, duplicate_old=False, bad_rating=False):
    def typed(value):
        if value is None:
            return {'nullValue': None}
        if type(value) is int:
            return {'integerValue': str(value)}
        if type(value) is float:
            return {'doubleValue': value}
        return {'stringValue': value}
    root = 'projects/test/databases/(default)'
    log = dict(timestamp='2025-12-01T00:00:00Z', lat=35.0, lng=134.0, memo='private',
               amount=0, amount_category='作業', stars='★★★★', locationName=None)
    other = log | {'timestamp': '2025-12-02T00:00:00Z', 'amount': None}
    if bad_rating:
        other['stars'] = 'six stars'
    docs = [dict(name=root+'/documents/categories/作業', fields={k: typed(v) for k, v in
                  dict(name='場所代場所代作業', color='#123456', order=1).items()})]
    for id, payload in [('a', log), ('b', other)] + ([('c', log)] if duplicate_new else []):
        docs.append(dict(name=root+'/documents/logs/'+id, fields={k: typed(v) for k, v in payload.items()}))
    fs = dict(project='test', database=root, readTime='2026-01-01T00:00:00Z', documents=docs)
    rt = dict(logs={'old': log, 'unmatched': log | {'memo': 'different'}},
              foodRank={'meal': dict(menue='meal', store='store', rank=1, amount=1450)})
    if duplicate_old:
        rt['logs']['old2'] = log
    manifest = dict(project='test', readTime=fs['readTime'], firestoreDocuments=len(docs),
                    collections=[dict(path=root+'/documents/'+c, documents=n, serverCount=n)
                                 for c, n in [('categories', 1), ('logs', len(docs)-1)]],
                    realtimeTopLevelCounts={k: len(v) for k, v in rt.items()}, files=[])
    for name, data in [('firestore-documents.json', fs), ('realtime-database.json', rt)]:
        payload = canonical(data).encode()
        (folder/name).write_bytes(payload)
        manifest['files'].append(dict(name=name, bytes=len(payload), sha256=digest(payload)))
    (folder/'manifest.json').write_text(canonical(manifest), encoding='utf-8')


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.db = connect()
        self.addCleanup(self.db.close)
        for id, kind in [('action', 'activity'), ('cost', 'expense'), ('income', 'income'), ('cost2', 'expense')]:
            put(self.db, 'categories', id=id, kind=kind, name=id)
        for id in ('trip1', 'trip2'):
            put(self.db, 'trips', id=id, name=id)
        add_activity(self.db, id='a', category_id='action', occurred_at='2025-11-30T15:00:00Z', trip_id='trip1',
                     memo='PRIVATE MEMO', latitude=35, longitude=134)
        self.db.commit()

    def expense(self, id='e', **kwargs):
        data = dict(id=id, category_id='cost', occurred_at='2025-11-30T15:00:00Z', amount_minor=100, activity_id='a')
        add_transaction(self.db, **(data | kwargs))
        self.db.commit()

    def test_zero_null_and_ratings(self):
        self.expense(amount_minor=0)
        self.assertEqual(validate(self.db)['zero_amount_transactions'], 1)
        for value in [1, '3', '★★★★★', None]:
            self.assertIn(rating(value), (1, 3, 5, None))
        for value in [0, 6, True, 3.5, '★★x']:
            with self.assertRaises(ValueError):
                rating(value)
        with self.assertRaises(ValueError):
            self.expense('float', amount_minor=1.5)

    def test_currency_refunds_and_month_boundary(self):
        self.expense()
        self.expense('nov', occurred_at='2025-11-30T14:59:59Z', amount_minor=10)
        self.expense('usd', currency='USD', minor_unit=2, amount_minor=1299)
        self.expense('estimate', currency='EUR', minor_unit=2, amount_minor=500, amount_jpy=800)
        self.expense('refund', kind='refund', refund_of='e', amount_minor=30)
        self.expense('salary', kind='income', category_id='income', amount_minor=500)
        result = totals(self.db, month='2025-12')
        self.assertEqual(result['expense_jpy'], 900)
        self.assertEqual(result['net_expense_jpy'], 870)
        self.assertEqual(result['net_cashflow_jpy'], -370)
        self.assertEqual(result['unconverted_count'], 1)
        self.assertEqual(result['estimated_count'], 1)
        self.assertEqual(totals(self.db, month='2025-11')['expense_jpy'], 10)
        with self.assertRaises(sqlite3.IntegrityError):
            self.expense('too_much', kind='refund', refund_of='e', amount_minor=71)
        self.db.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE transactions SET amount_jpy=200 WHERE id='e'")
        self.db.rollback()
        self.db.execute("UPDATE transactions SET amount_jpy=2000, conversion_status='final' WHERE id='usd'")
        self.db.commit()
        self.assertEqual(totals(self.db)['unconverted_count'], 0)

    def test_trip_move_and_mismatch(self):
        self.expense()
        self.expense('refund', kind='refund', refund_of='e', amount_minor=20)
        move_activity(self.db, 'a', 'trip2')
        self.assertEqual(totals(self.db, trip_id='trip1')['expense_jpy'], 0)
        self.assertEqual(totals(self.db, trip_id='trip2')['net_expense_jpy'], 80)
        with self.assertRaises(ValueError):
            self.expense('mismatch', trip_id='trip1')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE transactions SET trip_id='trip1' WHERE id='e'")

    def test_budgets_no_double_count_and_soft_retirement(self):
        self.expense()
        put(self.db, 'budgets', id='monthly', month='2025-12', total_jpy=1000)
        put(self.db, 'budgets', id='journey', trip_id='trip1', total_jpy=2000)
        put(self.db, 'budget_allocations', budget_id='monthly', category_id='cost', amount_jpy=700)
        self.db.commit()
        self.assertEqual(budget_status(self.db, 'monthly')['remaining_jpy'], 900)
        self.assertEqual(budget_status(self.db, 'monthly')['allocations'][0]['remaining_jpy'], 600)
        self.assertEqual(budget_status(self.db, 'journey')['remaining_jpy'], 1900)
        for statement in ["INSERT INTO budget_allocations VALUES('monthly','cost2','expense',301)",
                          "UPDATE budgets SET total_jpy=600 WHERE id='monthly'",
                          "INSERT INTO budgets VALUES('bad','2025-12','trip2',10)",
                          "DELETE FROM categories WHERE id='cost'"]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(statement)
            self.db.rollback()
        self.db.execute("UPDATE categories SET active=0 WHERE id='cost'")
        self.assertEqual(totals(self.db)['expense_jpy'], 100)

    def test_shared_receipt_private_snapshots_and_metadata(self):
        self.expense()
        self.expense('e2')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'photo.png'
            path.write_bytes(PNG)
            register_attachment(self.db, id='receipt', path=path, purpose='receipt', media_type='image/png',
                                activity_ids=['a'], transaction_ids=['e','e2'])
            register_attachment(self.db, id='photo', path=path, purpose='photo', media_type='image/png',
                                activity_ids=['a'])
            with self.assertRaises(ValueError):
                prepare_public_entry(self.db, id='denied', activity_id='a', date='2025-12-01', memo='safe', photo_ids=['receipt'])
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM public_entries').fetchone()[0], 0)
            prepare_public_entry(self.db, id='share', activity_id='a', date='2025-12-01', memo='selected text', photo_ids=['photo'])
            self.assertEqual(public_feed(self.db), [])
            set_public_status(self.db, 'share', published=True)
            self.db.execute("UPDATE activities SET memo='CHANGED PRIVATE' WHERE id='a'")
            self.db.commit()
            exported = json.dumps(public_feed(self.db))
            for secret in ['PRIVATE', 'amount', 'trip_id', 'latitude', 'storage_location', 'receipt', 'activity_id']:
                self.assertNotIn(secret, exported)
            self.assertEqual(public_feed(self.db)[0]['memo'], 'selected text')
            self.assertNotIn(b'PRIVATE', clean_png(PNG))
            self.assertEqual(clean_png(clean_png(PNG)), clean_png(PNG))
            self.assertEqual(validate(self.db)['counts']['transaction_attachments'], 2)
            set_public_status(self.db, 'share', published=False)
            self.assertEqual(public_feed(self.db), [])

    def test_corrupt_and_changed_photo_rejected(self):
        with self.assertRaises(ValueError):
            clean_png(PNG[:-1])
        with self.assertRaises(ValueError):
            clean_png(PNG + b'hidden payload')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'photo.png'
            path.write_bytes(PNG)
            register_attachment(self.db, id='photo', path=path, purpose='photo', media_type='image/png', activity_ids=['a'])
            path.write_bytes(PNG+b'extra')
            with self.assertRaises(ValueError):
                prepare_public_entry(self.db, id='share', activity_id='a', date='2025-12-01', memo='', photo_ids=['photo'])

    def test_restore_all_content_and_no_overwrite(self):
        self.expense()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'restored.sqlite'
            self.assertTrue(restore_test(self.db, path)['restore_tested'])
            with self.assertRaises(FileExistsError):
                restore_test(self.db, path)

    def test_outputs_outside_checkout(self):
        with self.assertRaises(ValueError):
            private_output(Path(__file__).parent/'data.sqlite')


class MigrationTests(unittest.TestCase):
    def run_fixture(self, **options):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name)
        backup_fixture(path, **options)
        db = connect()
        self.addCleanup(db.close)
        report = import_backup(db, path)
        return db, path, report

    def test_preservation_matching_zero_idempotence(self):
        db, path, report = self.run_fixture()
        self.assertEqual(report['counts']['activities'], 2)
        self.assertEqual(report['counts']['transactions'], 1)
        self.assertEqual(report['zero_amount_transactions'], 1)
        self.assertEqual(report['activities_without_transaction'], 1)
        self.assertEqual(report['source_statuses']['matched'], 1)
        self.assertEqual(report['source_statuses']['needs_review'], 2)
        self.assertEqual(report['counts']['places'], 0)
        self.assertEqual(report['counts']['budgets'], 0)
        self.assertEqual(report['counts']['food_reviews'], 1)
        self.assertEqual(db.execute('SELECT rating FROM activities LIMIT 1').fetchone()[0], 4)
        self.assertEqual(db.execute('SELECT original_id,original_label FROM category_aliases LIMIT 1').fetchone()[:],
                         ('作業','場所代場所代作業'))
        before = database_fingerprint(db)
        self.assertEqual(verify_against_backup(db, path)['converted_logs_compared'], 2)
        self.assertEqual(import_backup(db, path), report)
        self.assertEqual(database_fingerprint(db), before)
        (path/'realtime-database.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            import_backup(db, path)
        self.assertEqual(database_fingerprint(db), before)

    def test_ambiguous_new_keeps_each_record(self):
        db, _, report = self.run_fixture(duplicate_new=True)
        self.assertEqual(report['counts']['activities'], 3)
        self.assertNotIn('matched', report['source_statuses'])
        self.assertEqual(report['source_statuses']['needs_review'], 3)

    def test_ambiguous_old_never_collapses(self):
        _, _, report = self.run_fixture(duplicate_old=True)
        self.assertEqual(report['counts']['activities'], 2)
        self.assertNotIn('matched', report['source_statuses'])
        self.assertEqual(report['source_statuses']['needs_review'], 4)

    def test_invalid_log_preserved_without_partial_conversion(self):
        db, _, report = self.run_fixture(bad_rating=True)
        self.assertEqual(report['counts']['activities'], 1)
        row = db.execute("SELECT raw_json,status FROM source_records WHERE source_path='logs/b'").fetchone()
        self.assertIn('six stars', row['raw_json'])
        self.assertEqual(row['status'], 'needs_review')

    def test_readback_detects_content_change_even_when_counts_match(self):
        db, path, _ = self.run_fixture()
        db.execute("UPDATE activities SET memo='changed'")
        db.commit()
        with self.assertRaisesRegex(ValueError, 'activity differs'):
            verify_against_backup(db, path)


if __name__ == '__main__':
    unittest.main()
