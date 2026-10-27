import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import quote

import build_dashboard as build
import validate_study as validate
import verify_dashboard as verify

META = '---\ntype: note\nauthor: alice\ncreated: 2026-10-24\nstatus: draft\ntags: []\n---\n'


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.folder = self.root / 'members/alice/notes/한 글'
        self.folder.mkdir(parents=True)

    def note(self, name='one.md', body='# Body\n'):
        path = self.folder / name
        path.write_text((f'<!--\n{META}-->\n' if path.suffix in {'.html', '.htm'} else META) + body)
        return path

    def test_reader_contract_and_html_ids(self):
        body = '# Body\n![image](assets/a.png)\n'
        self.note(body=body)
        self.note('one.html', '<h1>HTML</h1>\n')
        self.note('other.htm', '<p>Other</p>')
        (self.folder / 'asset.html').write_text('<p>No metadata</p>')
        data = build.build_dashboard_data(self.root, 'https://github.com/org/repo', 'main')
        notes = {n['id']: n for n in data['notes']}
        self.assertEqual(set(notes), {'alice/한 글/one', 'alice/한 글/one.html', 'alice/한 글/other.htm'})
        md = notes['alice/한 글/one']
        self.assertEqual(md['content'], body)
        self.assertEqual(md['format'], 'markdown')
        self.assertEqual(md['url'], './reader.html?note=' + quote(md['id'], safe=''))
        self.assertEqual(md['asset_base'], './content/members/alice/notes/%ED%95%9C%20%EA%B8%80/')
        self.assertEqual(md['source_url'], 'https://github.com/org/repo/blob/main/members/alice/notes/%ED%95%9C%20%EA%B8%80/one.md')
        self.assertEqual(notes['alice/한 글/one.html']['content'], '<h1>HTML</h1>\n')
        self.assertEqual(notes['alice/한 글/one.html']['format'], 'html')

    def test_cli_exports_public_assets_and_removes_stale_output(self):
        path = self.note(body='![img](assets/a.png)')
        assets = self.folder / 'assets'
        assets.mkdir()
        for name in ['a.png', 'theme.css', 'font.woff2', 'secret.png', '.hidden.png', 'key.pem', 'app.js']:
            (assets / name).write_text('fixture')
        private = assets / 'private'
        private.mkdir()
        (private / 'leak.png').write_text('private')
        output = self.root / 'dashboard/data.json'
        self.assertEqual(build.main(['--root', str(self.root)]), 0)
        content = output.parent / 'content'
        relative = path.relative_to(self.root)
        self.assertEqual((content / relative).read_text(), path.read_text())
        exported = {p.name for p in (content / relative.parent / 'assets').rglob('*') if p.is_file()}
        self.assertEqual(exported, {'a.png', 'theme.css', 'font.woff2'})
        (assets / 'a.png').unlink()
        build.main(['--root', str(self.root)])
        self.assertFalse((content / relative.parent / 'assets/a.png').exists())

    def test_exported_html_cannot_bypass_reader_sandbox(self):
        path = self.note('unsafe.html', '<script>parent.pwned=true</script>')
        build.main(['--root', str(self.root)])
        exported = self.root / 'dashboard/content' / path.relative_to(self.root)
        text = exported.read_text()
        self.assertNotIn('<script>', text)
        self.assertIn('reader.html?note=alice%2F', text)
        self.assertIn('http-equiv="refresh"', text)

    def test_symlink_notes_and_assets_rejected(self):
        self.note()
        outside = self.root / 'outside.png'
        outside.write_text('private')
        for name in ['alias.md', 'alias.png', 'alias-dir']:
            link = self.folder / name
            link.symlink_to(outside if name != 'alias-dir' else self.root, target_is_directory=name == 'alias-dir')
            with self.subTest(name=name):
                self.assertTrue(any('symlink' in error.lower() for error in validate.validate_notes(self.root)))
                with self.assertRaisesRegex(ValueError, '(?i)symlink'):
                    build.build_dashboard_data(self.root)
            link.unlink()

    def test_html_validation_and_local_path_boundary(self):
        html = self.note('page.html', '<img src="assets/missing.png">')
        errors = validate.validate_notes(self.root)
        self.assertTrue(any('missing local link' in e for e in errors))
        html.write_text('<!--\n' + META + '-->\n<a href="../../../../../outside.md">escape</a>')
        self.assertTrue(any('outside' in e.lower() for e in validate.validate_notes(self.root)))
        html.write_text('<p>No metadata</p>')
        self.assertTrue(any('missing YAML frontmatter' in e for e in validate.validate_notes(self.root)))

    def test_verifier_checks_reader_assets_and_exported_notes(self):
        self.note()
        build.main(['--root', str(self.root), '--repo-url', 'https://github.com/org/repo'])
        dashboard = self.root / 'dashboard'
        (dashboard / 'index.html').write_text('<a href="reader.html">Read</a>')
        (dashboard / 'reader.html').write_text('<script src="reader.js"></script>')
        old_root, old_dashboard = verify.ROOT, verify.DASHBOARD
        verify.ROOT, verify.DASHBOARD = self.root, dashboard
        self.addCleanup(setattr, verify, 'ROOT', old_root)
        self.addCleanup(setattr, verify, 'DASHBOARD', old_dashboard)
        with self.assertRaisesRegex(AssertionError, 'Missing asset'):
            verify.main()
        (dashboard / 'reader.js').write_text('')
        verify.main()
        (dashboard / 'content/members/alice/notes/한 글/one.md').unlink()
        with self.assertRaises(AssertionError):
            verify.main()


if __name__ == '__main__':
    unittest.main()
