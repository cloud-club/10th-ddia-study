#!/usr/bin/env python3
"""Build the DDIA study dashboard data from members/<github-id>/notes/.

No third-party Python packages are required.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\n(.*?)\n---[ \t]*(?:\n|\Z)", re.S)
HEADING_RE = re.compile(r"^#\s+(.+?)\s*$", re.M)
NUMBER_PREFIX_RE = re.compile(r"^\d+[-_.\s]*")
SUMMARY_PLACEHOLDERS = {"한 문장으로 요약을 작성하세요.", "이 주제를 한 문장으로 설명합니다."}


def parse_scalar(value: str) -> str | list[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        return [part.strip().strip("\"'") for part in value[1:-1].split(",") if part.strip()]
    return value.strip("\"'")


def parse_frontmatter(text: str) -> tuple[dict[str, str | list[str]], str]:
    """Parse the small YAML subset used by the note template."""
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text

    metadata: dict[str, str | list[str]] = {}
    list_key: str | None = None
    for line in match.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- ") and list_key:
            current = metadata.setdefault(list_key, [])
            if isinstance(current, list):
                current.append(stripped[2:].strip().strip("\"'"))
            continue
        if ":" not in stripped:
            continue
        key, _, raw = stripped.partition(":")
        key, raw = key.strip(), raw.strip()
        if not raw:
            metadata[key] = []
            list_key = key
        else:
            metadata[key] = parse_scalar(raw)
            list_key = None
    return metadata, text[match.end():]


def first_heading(body: str) -> str:
    match = HEADING_RE.search(body)
    return match.group(1).strip() if match else ""


def extract_summary(body: str, limit: int = 240) -> str:
    """Return the first plain-text paragraph beneath the `한 줄 요약` heading."""
    match = re.search(r"^##\s+한 줄 요약\s*$\n(.*?)(?=^#{1,2}\s|\Z)", body, re.M | re.S)
    if not match:
        return ""
    text = re.sub(r"```.*?```", "", match.group(1), flags=re.S)
    paragraphs = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("<!--", ">", "|")):
            continue
        paragraphs.append(line)
    summary = re.sub(r"\s+", " ", " ".join(paragraphs)).strip()
    if summary in SUMMARY_PLACEHOLDERS:
        return ""
    return summary[:limit]


def normalize_tags(value: str | list[str] | None) -> list[str]:
    raw = [value] if isinstance(value, str) else value if isinstance(value, list) else []
    tags: list[str] = []
    for item in raw:
        tag = str(item).strip().lower().lstrip("#")
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def display_title(metadata: dict[str, str | list[str]], body: str, path: Path) -> str:
    title = metadata.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    heading = first_heading(body)
    if heading:
        return heading
    return NUMBER_PREFIX_RE.sub("", path.stem).replace("-", " ").replace("_", " ").strip() or path.stem


def note_url(relative_path: str, repo_url: str, branch: str) -> str:
    encoded_path = quote(relative_path, safe="/-._~")
    if not repo_url:
        return f"../{encoded_path}"
    encoded_branch = quote(branch or "main", safe="/-._~")
    return f"{repo_url.rstrip('/')}/blob/{encoded_branch}/{encoded_path}"


def extract_readings(body: str) -> list[dict]:
    match = re.search(r"^##\s+참고 자료\s*$\n(.*?)(?=^##\s|\Z)", body, re.M | re.S)
    if not match:
        return []
    readings = []
    for line in match.group(1).splitlines():
        item = re.sub(r"^[-*]\s+", "", line.strip())
        if not item or item.startswith((">", "<!--", "#")):
            continue
        link = re.fullmatch(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", item)
        readings.append({"title": link.group(1) if link else item, "url": link.group(2) if link else None})
    return readings


def parse_note(
    path: Path,
    root: Path,
    repo_url: str,
    branch: str,
    *,
    member_id: str | None = None,
    url_path: str | None = None,
    note_id: str | None = None,
) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    metadata, body = parse_frontmatter(text)
    relative = path.relative_to(root).as_posix()
    parts = Path(relative).parts
    member_id = member_id or parts[1]
    relative_url = url_path or relative

    created = metadata.get("created", "")
    created = created.strip() if isinstance(created, str) else ""
    try:
        dt.date.fromisoformat(created)
    except ValueError:
        created = ""

    status = metadata.get("status", "draft")
    status = status.strip().lower() if isinstance(status, str) else "draft"
    if status not in {"draft", "completed"}:
        status = "draft"

    explicit_summary = metadata.get("summary", "")
    summary = explicit_summary.strip() if isinstance(explicit_summary, str) else ""
    if not summary:
        summary = extract_summary(body)

    return {
        "id": note_id or f"{member_id}/{Path(*parts[3:]).with_suffix('').as_posix()}",
        "member": member_id,
        "title": display_title(metadata, body, path),
        "created": created,
        "status": status,
        "summary": summary,
        "tags": normalize_tags(metadata.get("tags")),
        "url": note_url(relative_url, repo_url, branch),
        "path": relative,
        "readings": extract_readings(body),
    }


def build_graph(notes: list[dict]) -> dict:
    """Emit only provenance-backed membership and tag edges, not semantic claims."""
    nodes: dict[str, dict] = {}
    edges: dict[tuple[str, str, str], dict] = {}
    for note in notes:
        member_id = f"member:{note['member']}"
        note_id = f"note:{note['id']}"
        nodes[member_id] = {"id": member_id, "type": "member", "label": note["member"]}
        nodes[note_id] = {"id": note_id, "type": "note", "label": note["title"], "url": note["url"]}
        edges[(member_id, note_id, "authored")] = {
            "source": member_id, "target": note_id, "type": "authored", "label": "작성",
        }
        for tag in note["tags"]:
            topic_id = f"topic:{tag}"
            nodes[topic_id] = {"id": topic_id, "type": "topic", "label": tag}
            edges[(note_id, topic_id, "tagged")] = {
                "source": note_id, "target": topic_id, "type": "tagged", "label": "태그",
            }
    return {"nodes": [nodes[key] for key in sorted(nodes)], "edges": [edges[key] for key in sorted(edges)]}


def build_dashboard_data(
    root: Path,
    repo_url: str = "",
    branch: str = "",
    generated_at: str | None = None,
) -> dict:
    root = root.expanduser().resolve()
    members_root = root / "members"
    note_paths: list[Path] = []
    if members_root.is_dir():
        for member_dir in sorted(members_root.iterdir(), key=lambda item: item.name.casefold()):
            notes_dir = member_dir / "notes"
            if not member_dir.is_dir() or member_dir.name.startswith((".", "_")) or not notes_dir.is_dir():
                continue
            for path in notes_dir.rglob("*.md"):
                relative_parts = path.relative_to(notes_dir).parts
                if path.name.startswith((".", "_")) or any(part.startswith((".", "_")) for part in relative_parts[:-1]):
                    continue
                note_paths.append(path)

    notes = [parse_note(path, root, repo_url, branch) for path in note_paths]
    notes.sort(key=lambda item: (item["created"], item["member"].casefold(), item["path"]), reverse=True)

    by_member: dict[str, list[dict]] = {}
    topic_counts: Counter[str] = Counter()
    for note in notes:
        by_member.setdefault(note["member"], []).append(note)
        topic_counts.update(note["tags"])

    members = [
        {
            "id": member_id,
            "note_count": len(member_notes),
            "latest_date": max((note["created"] for note in member_notes), default=""),
            "xp": len(member_notes) * 40,
            "level": len(member_notes) * 40 // 100 + 1,
            "xp_in_level": len(member_notes) * 40 % 100,
            "activity": [
                {"date": date, "count": count}
                for date, count in sorted(Counter(note["created"] for note in member_notes if note["created"]).items())
            ],
        }
        for member_id, member_notes in sorted(by_member.items(), key=lambda item: item[0].casefold())
    ]
    topics = [
        {"tag": tag, "notes": count}
        for tag, count in sorted(topic_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    reading_index: dict[tuple, dict] = {}
    for note in notes:
        seen = set()
        for reading in note["readings"]:
            key = (reading["title"], reading["url"])
            if key in seen:
                continue
            seen.add(key)
            entry = reading_index.setdefault(key, {**reading, "note_count": 0})
            entry["note_count"] += 1
    readings = sorted(reading_index.values(), key=lambda item: item["title"].casefold())
    feed = [
        {"member": note["member"], "title": note["title"], "summary": note["summary"],
         "date": note["created"], "url": note["url"], "tags": note["tags"]}
        for note in notes
    ]
    timestamp = generated_at or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    return {
        "generated_at": timestamp,
        "repository": {"url": repo_url.rstrip("/"), "branch": branch or ("main" if repo_url else "")},
        "totals": {"members": len(members), "notes": len(notes), "topics": len(topics)},
        "members": members,
        "topics": topics,
        "notes": notes,
        "graph": build_graph(notes),
        "feed": feed,
        "readings": readings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="study directory (default: repository root)")
    parser.add_argument("--output", type=Path, help="output JSON path (default: <root>/dashboard/data.json)")
    parser.add_argument("--repo-url", default=os.environ.get("GITHUB_REPOSITORY_URL", ""))
    parser.add_argument("--branch", default=os.environ.get("DASHBOARD_BRANCH", ""))
    args = parser.parse_args(argv)

    repo_url = args.repo_url.strip()
    if not repo_url:
        repository = os.environ.get("GITHUB_REPOSITORY", "").strip()
        if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            repo_url = f"https://github.com/{repository}"
    branch = args.branch.strip() or os.environ.get("GITHUB_REF_NAME", "").strip()
    output = args.output or (args.root / "dashboard" / "data.json")
    data = build_dashboard_data(args.root, repo_url=repo_url, branch=branch)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    totals = data["totals"]
    print(f"[dashboard] {output}: 멤버 {totals['members']} · 노트 {totals['notes']} · 주제 {totals['topics']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
