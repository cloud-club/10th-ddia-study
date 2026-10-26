#!/usr/bin/env python3
"""Validate note metadata and local links in the DDIA study workspace."""
from __future__ import annotations

import datetime as dt
import re
import sys
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_dashboard import parse_frontmatter  # noqa: E402

LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
ALLOWED_STATUS = {"draft", "completed"}


def note_paths(root: Path) -> list[Path]:
    members = root / "members"
    if not members.is_dir():
        return []
    paths = []
    for member_dir in members.iterdir():
        notes_dir = member_dir / "notes"
        if not member_dir.is_dir() or member_dir.name.startswith((".", "_")) or not notes_dir.is_dir():
            continue
        for path in notes_dir.rglob("*.md"):
            parts = path.relative_to(notes_dir).parts
            if path.name.startswith((".", "_")) or any(part.startswith((".", "_")) for part in parts[:-1]):
                continue
            paths.append(path)
    return sorted(paths)


def validate_notes(root: Path) -> list[str]:
    root = root.expanduser().resolve()
    errors: list[str] = []
    for path in note_paths(root):
        relative = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        metadata, _ = parse_frontmatter(text)
        if not metadata:
            errors.append(f"{relative}: missing YAML frontmatter")
            continue

        if metadata.get("type") != "note":
            errors.append(f"{relative}: type must be 'note'")
        member_id = path.relative_to(root / "members").parts[0]
        if metadata.get("author") != member_id:
            errors.append(f"{relative}: author must match member directory '{member_id}'")

        created = metadata.get("created")
        try:
            parsed_date = dt.date.fromisoformat(created) if isinstance(created, str) else None
        except ValueError:
            parsed_date = None
        if not parsed_date or parsed_date.isoformat() != created:
            errors.append(f"{relative}: invalid created date (expected YYYY-MM-DD)")

        if metadata.get("status") not in ALLOWED_STATUS:
            errors.append(f"{relative}: invalid status (expected draft or completed)")
        if not isinstance(metadata.get("tags"), list):
            errors.append(f"{relative}: tags must be a YAML list (use 'tags: []' when empty)")

        for match in LINK_RE.finditer(text):
            target = unquote(match.group(1).strip().strip("<>"))
            if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = target.split("#", 1)[0]
            if target and not (path.parent / target).resolve().exists():
                errors.append(f"{relative}: missing local link target '{target}'")

    return errors


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    errors = validate_notes(root)
    if errors:
        print("DDIA note validation: FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"DDIA note validation: PASS ({len(note_paths(root))} note(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
