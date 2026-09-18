"""Validate an offline migration and save a reproducible, private evidence report."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import json

from model import (connect, database_fingerprint, import_backup, private_output,
                   restore_test, verify_against_backup)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--restore', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    database, restored, report_path = [private_output(p) for p in (args.database, args.restore, args.report)]
    if not database.is_file():
        parser.error('import the database first')
    if restored.exists() or report_path.exists():
        parser.error('restore and report must be new files')
    with closing(connect(database)) as db:
        verification = verify_against_backup(db, args.backup)
        before = database_fingerprint(db)
        import_backup(db, args.backup)
        if database_fingerprint(db) != before:
            raise ValueError('repeated import changed content')
        restoration = restore_test(db, restored)
    with closing(connect(restored)) as db:
        if verify_against_backup(db, args.backup) != verification:
            raise ValueError('restored verification differs')
    report = dict(checked_at=datetime.now(timezone.utc).isoformat(), verification=verification,
                  repeated_import_unchanged=True, restoration=restoration,
                  source_database=str(database), restored_database=str(restored),
                  scope='Offline model only. No Firebase write, deployment, or Firebase restore test.')
    with report_path.open('x', encoding='utf-8') as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
    print(json.dumps(dict(report=str(report_path), compared=verification['source_records_compared'],
                          repeated_import_unchanged=True, restore_tested=True), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
