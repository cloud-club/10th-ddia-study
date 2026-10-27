"""Check generated JSON, reader entrypoints and exported notes before upload."""
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from note_files import checked_path
from build_dashboard import parse_frontmatter

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = ROOT / "dashboard"


class Assets(HTMLParser):
    def __init__(self, base=None):
        super().__init__()
        self.base = base or DASHBOARD

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key not in {"src", "href"} or not value:
                continue
            url = urlsplit(value)
            if url.scheme or url.netloc or not url.path:
                continue
            try:
                target = checked_path(self.base / unquote(url.path), DASHBOARD)
            except ValueError as error:
                raise AssertionError(f"Asset outside Pages artifact or symlink: {value}") from error
            if target.is_dir():
                target = target / "index.html"
            assert target.is_file(), f"Missing asset: {value}"


def main():
    for entry in ("index.html", "reader.html"):
        path = checked_path(DASHBOARD / entry, DASHBOARD)
        assert path.is_file(), f"Missing asset: {entry}"
        Assets().feed(path.read_text(encoding="utf-8"))
    data = json.loads((DASHBOARD / "data.json").read_text(encoding="utf-8"))
    assert data["totals"] == {"members": len(data["members"]), "notes": len(data["notes"]), "topics": len(data["topics"])}
    ids = {node["id"] for node in data["graph"]["nodes"]}
    assert all(edge["source"] in ids and edge["target"] in ids for edge in data["graph"]["edges"])
    for note in data["notes"]:
        source = checked_path(ROOT / note["path"], ROOT)
        assert source.is_file(), f"Missing source: {note['path']}"
        assert note["url"] == "./reader.html?note=" + quote(note["id"], safe="")
        if data["repository"]["url"]:
            assert note["source_url"].startswith(data["repository"]["url"] + "/blob/")
        exported = checked_path(DASHBOARD / "content" / note["path"], DASHBOARD)
        assert exported.is_file(), f"Missing exported note: {note['path']}"
        if note["format"] == "html":
            _, body = parse_frontmatter(source.read_text(encoding="utf-8"))
            assert exported.read_text(encoding="utf-8") == body, "Stale HTML export"
        else:
            assert exported.read_bytes() == source.read_bytes(), f"Stale exported note: {note['path']}"
        expected_base = "./content/" + quote(Path(note["path"]).parent.as_posix(), safe="/") + "/"
        assert note["asset_base"] == expected_base
        assert note["format"] in {"markdown", "html"}
        if note["format"] == "html":
            Assets(exported.parent).feed(note["content"])
    print("Dashboard artifact: PASS", data["totals"])


if __name__ == "__main__":
    main()
