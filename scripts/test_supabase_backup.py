"""Synthetic tests only: no database connections or user data."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import tarfile
import json
import hashlib
import subprocess

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('supabase-backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafetyTests(unittest.TestCase):
    def test_repository_output_rejected(self):
        with self.assertRaises(ValueError):
            backup.outside_repo(Path(__file__).resolve().parents[1] / 'backups')

    def test_diagnostics_not_exposed(self):
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'SECRET')):
            with self.assertRaisesRegex(RuntimeError, 'diagnostics suppressed') as error:
                backup.run(['pg_dump'])
            self.assertNotIn('SECRET', str(error.exception))

    def scenario(self, missing_auth=False, encrypt_fail=False):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            output, staging = base / 'output', base / 'staging'
            service, password = base / 'service', base / 'password'
            for file in (service, password):
                file.write_text('synthetic')
                file.chmod(0o600)
            args = ['backup', '--output-dir', str(output), '--staging-dir', str(staging),
                    '--recipient', 'age1synthetic', '--encrypted-staging-confirmed']
            def fake_run(command):
                if command[0] == 'pg_dump' and '--file' in command:
                    Path(command[-1]).write_bytes(b'SYNTHETIC DUMP')
                elif command[0] == 'pg_restore':
                    toc = '\n'.join('TABLE DATA public ' + name + ' owner' for name in
                                    ('profiles', 'subscriptions', 'favorite_places', 'place_settings'))
                    return (toc + ('' if missing_auth else '\nTABLE DATA auth users owner')).encode()
                elif command[0] == 'pg_dumpall':
                    self.assertIn('--no-role-passwords', command)
                    return b'-- synthetic roles'
                elif command[0] == 'age':
                    if encrypt_fail:
                        Path(command[4]).write_bytes(b'partial')
                        raise RuntimeError('encryption failure')
                    with tarfile.open(command[5]) as archive:
                        manifest = json.load(archive.extractfile('manifest.json'))
                        for name, checksum in manifest['sha256'].items():
                            self.assertEqual(hashlib.sha256(archive.extractfile(name).read()).hexdigest(), checksum)
                    Path(command[4]).write_bytes(b'synthetic ciphertext')
                return b'pg_dump synthetic version'
            with patch.dict(os.environ, {'PGSERVICE': 'test', 'PGSERVICEFILE': str(service), 'PGPASSFILE': str(password)}, clear=True), \
                 patch('sys.argv', args), patch.object(backup.shutil, 'which', return_value='/fake/tool'), \
                 patch.object(backup, 'run', side_effect=fake_run):
                if missing_auth or encrypt_fail:
                    with self.assertRaises(RuntimeError):
                        backup.main()
                    self.assertEqual(list(output.iterdir()), [])
                else:
                    backup.main()
                    self.assertEqual(len(list(output.glob('*.tar.age'))), 1)
                    self.assertEqual(len(list(output.glob('*.sha256'))), 1)
                self.assertEqual(list(staging.iterdir()), [])

    def test_complete_synthetic_archive(self):
        self.scenario()

    def test_missing_auth_rejected(self):
        self.scenario(missing_auth=True)

    def test_encryption_failure_leaves_no_archive(self):
        self.scenario(encrypt_fail=True)


if __name__ == '__main__':
    unittest.main()
