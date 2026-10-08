#!/usr/bin/env python3
"""Manual PostgreSQL backup. Never loads application .env files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone


def run(args, **kwargs):
    # Do not relay tool output: database diagnostics can contain sensitive values.
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed; backup is NOT verified (diagnostics suppressed)')
    return result.stdout


def sha256(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def outside_repo(path):
    path = Path(path).expanduser().resolve()
    repo = Path(__file__).resolve().parents[1]
    if path == repo or repo in path.parents:
        raise ValueError('Backup and staging paths must be outside the repository')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--staging-dir', required=True, help='Private directory on an encrypted volume')
    parser.add_argument('--recipient', required=True, help='age public recipient; never a private key')
    parser.add_argument('--encrypted-staging-confirmed', action='store_true')
    args = parser.parse_args()
    if not args.encrypted_staging_confirmed:
        parser.error('Administrator must confirm staging is on an encrypted volume')
    if not all(os.environ.get(key) for key in ('PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE')):
        parser.error('Use PGSERVICE and PGSERVICEFILE outside Git, with a separate PGPASSFILE')
    for key in ('PGSERVICEFILE', 'PGPASSFILE'):
        private_file = outside_repo(os.environ[key])
        if not private_file.is_file() or private_file.stat().st_mode & 0o077:
            parser.error(f'{key} must reference a private file with permissions 0600')
    # All connection configuration stays in private libpq files, not command arguments.
    for key in ('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGOPTIONS'):
        if key in os.environ:
            parser.error(f'Unset {key}; use only the reviewed libpq service')
    for tool in ('pg_dump', 'pg_dumpall', 'pg_restore', 'age'):
        if not shutil.which(tool):
            parser.error(f'Missing required tool: {tool}')
    output = outside_repo(args.output_dir)
    staging = outside_repo(args.staging_dir)
    for directory in (output, staging):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if directory.stat().st_mode & 0o077:
            parser.error('Output and staging directories must have permissions 0700')
    os.umask(0o077)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    final = output / f'meteo-puls-{stamp}.tar.age'
    if final.exists():
        parser.error('Archive already exists')
    partial = output / f'.{final.name}.partial'
    try:
        with tempfile.TemporaryDirectory(prefix='meteo-backup-', dir=staging) as tmp:
            root = Path(tmp)
            dump = root / 'database.dump'
            run(['pg_dump', '--no-password', '--format=custom', '--file', str(dump)])
            toc = run(['pg_restore', '--list', str(dump)])
            for table in ('profiles', 'subscriptions', 'favorite_places', 'place_settings'):
                if f'TABLE DATA public {table} '.encode() not in toc:
                    raise RuntimeError(f'Missing required table data: {table}')
            if b'TABLE DATA auth users ' not in toc:
                raise RuntimeError('Missing Auth users; archive is incomplete')
            # No role passwords. Owner/ACL references in database.dump are retained.
            roles = run(['pg_dumpall', '--no-password', '--roles-only', '--no-role-passwords'])
            (root / 'roles.sql').write_bytes(roles)
            (root / 'contents.txt').write_bytes(toc)
            files = ('database.dump', 'roles.sql', 'contents.txt')
            manifest = {'format': 1, 'created_utc': stamp,
                        'pg_dump_version': run(['pg_dump', '--version']).decode().strip(),
                        'sha256': {name: sha256(root / name) for name in files},
                        'storage_files_included': False}
            (root / 'manifest.json').write_text(json.dumps(manifest, indent=2))
            bundle = root / 'backup.tar'
            with tarfile.open(bundle, 'w') as archive:
                for name in (*files, 'manifest.json'):
                    archive.add(root / name, arcname=name)
            run(['age', '--recipient', args.recipient, '--output', str(partial), str(bundle)])
            if partial.stat().st_size == 0:
                raise RuntimeError('Empty encrypted archive')
            # Publish only after every export and encryption step succeeds.
            partial.rename(final)
            checksum = sha256(final)
            final.with_suffix(final.suffix + '.sha256').write_text(f'{checksum}  {final.name}\n')
            print(f'Encrypted archive created: {final}')
            print('Export structure checked; decrypt, verify hashes and perform isolated restore before declaring recoverability.')
    finally:
        partial.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError):
        raise SystemExit('Backup failed. Do not treat this run as successful; review configuration privately.')
