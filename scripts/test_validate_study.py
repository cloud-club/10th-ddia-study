from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_study


class ValidateStudyTests(unittest.TestCase):
    def test_accepts_a_complete_note_with_external_reference(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note = root / "members" / "alice" / "notes" / "01-storage.md"
            note.parent.mkdir(parents=True)
            note.write_text(
                "---\n"
                "type: note\n"
                "author: alice\n"
                "created: 2026-10-24\n"
                "status: draft\n"
                "tags: []\n"
                "---\n\n"
                "# Storage\n\n"
                "[Reference](https://example.com)\n",
                encoding="utf-8",
            )

            self.assertEqual(validate_study.validate_notes(root), [])

    def test_rejects_wrong_author_date_status_and_broken_local_link(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note = root / "members" / "alice" / "notes" / "01-storage.md"
            note.parent.mkdir(parents=True)
            note.write_text(
                "---\n"
                "type: note\n"
                "author: bob\n"
                "created: someday\n"
                "status: done\n"
                "tags: []\n"
                "---\n\n"
                "# Storage\n\n"
                "[Missing](./missing.md)\n",
                encoding="utf-8",
            )

            errors = validate_study.validate_notes(root)

            self.assertEqual(len(errors), 4)
            self.assertTrue(any("author must match" in error for error in errors))
            self.assertTrue(any("invalid created date" in error for error in errors))
            self.assertTrue(any("invalid status" in error for error in errors))
            self.assertTrue(any("missing local link" in error for error in errors))

    def test_checks_notes_in_nested_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            nested = root / "members" / "alice" / "notes" / "chapter-2" / "01.md"
            nested.parent.mkdir(parents=True)
            nested.write_text("# Missing metadata\n", encoding="utf-8")

            errors = validate_study.validate_notes(root)

            self.assertEqual(len(errors), 1)
            self.assertIn("missing YAML frontmatter", errors[0])


if __name__ == "__main__":
    unittest.main()
