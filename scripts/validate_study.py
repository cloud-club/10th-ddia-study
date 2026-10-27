#!/usr/bin/env python3
"""Validate note metadata and local links in the DDIA study workspace."""
from __future__ import annotations

import datetime as dt
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
from html.parser import HTMLParser

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_dashboard import parse_frontmatter  # noqa: E402
from note_files import note_paths, checked_path

LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
ALLOWED_STATUS = {"draft", "completed"}


class HTMLLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []

    def handle_starttag(self, tag, attrs):
        self.targets.extend(value for key, value in attrs if key in {"src", "href"} and value)


def local_links(body: str, html: bool = False) -> list[str]:
    if html:
        parser = HTMLLinks()
        parser.feed(body)
        return parser.targets
    return [match.group(1).strip("<>") for match in LINK_RE.finditer(body)]


def validate_notes(root: Path) -> list[str]:
    root = root.expanduser().resolve()
    errors: list[str] = []
    try:
        paths = note_paths(root)
    except ValueError as error:
        return [str(error)]
    for path in paths:
        relative = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        metadata, body = parse_frontmatter(text)
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

        for value in local_links(body, path.suffix.lower() in {".html", ".htm"}):
            url = urlsplit(value)
            if url.scheme or url.netloc or not url.path:
                continue
            target = unquote(url.path)
            candidate = path.parent / target
            try:
                checked_path(candidate, root / "members" / member_id / "notes")
                if not candidate.resolve().is_relative_to(root / "members" / member_id / "notes"):
                    raise ValueError(f"Path outside allowed boundary: {target}")
            except ValueError as error:
                errors.append(f"{relative}: {error}")
                continue
            if not candidate.is_file():
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
