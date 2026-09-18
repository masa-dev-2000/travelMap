"""Export verified model data as a D1-compatible SQL file outside the checkout."""
import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'data_model'))
from model import private_output, validate, verify_against_backup

# Parents before children. Refund expenses precede refunds; no deferred FK behavior required.
TABLES = ['schema_version', 'trips', 'categories', 'places', 'activities', 'transactions',
          'budgets', 'budget_allocations', 'food_reviews', 'attachments', 'activity_attachments',
          'transaction_attachments', 'public_entries', 'public_photos', 'import_batches',
          'source_records', 'source_targets', 'category_aliases']


def export(db, destination):
    validate(db)
    # Original local attachment paths require an explicit R2 upload/mapping step, never copy them as URLs.
    if db.execute('SELECT COUNT(*) FROM attachments').fetchone()[0] or db.execute('SELECT COUNT(*) FROM public_photos').fetchone()[0]:
        raise ValueError('existing files need an R2 migration before this export')
    schema = Path(__file__).resolve().parents[1] / 'data_model' / 'schema.sql'
    extra = Path(__file__).with_name('schema-extra.sql')
    sql = schema.read_text(encoding='utf-8').replace('PRAGMA foreign_keys = ON;', '')
    sql += '\n' + extra.read_text(encoding='utf-8') + '\n'
    for table in TABLES:
        if table == 'schema_version':
            continue  # schema owns this singleton
        order = " ORDER BY CASE WHEN kind='refund' THEN 1 ELSE 0 END,id" if table == 'transactions' else ''
        columns = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
        quoted = ','.join('"'+c+'"' for c in columns)
        for row in db.execute(f'SELECT * FROM "{table}"' + order):
            values = ','.join(db.execute('SELECT quote(?)', (v,)).fetchone()[0] for v in row)
            sql += f'INSERT INTO "{table}" ({quoted}) VALUES ({values});\n'
    with private_output(destination).open('x', encoding='utf-8', newline='\n') as output:
        output.write(sql)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    with closing(sqlite3.connect(private_output(args.database).as_uri()+'?mode=ro', uri=True)) as db:
        db.row_factory=sqlite3.Row
        result=verify_against_backup(db,args.backup)
        export(db,args.output)
    print(f"Exported {result['converted_logs_compared']} verified activities. Import into an empty D1 only.")
