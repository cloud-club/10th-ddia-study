"""Check generated JSON and every local HTML asset before Pages upload."""
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = ROOT / "dashboard"


class Assets(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key not in {"src", "href"} or not value:
                continue
            url = urlsplit(value)
            if url.scheme or url.netloc or not url.path:
                continue
            target = (DASHBOARD / unquote(url.path)).resolve()
            assert target.is_relative_to(DASHBOARD), f"Asset outside Pages artifact: {value}"
            if target.is_dir():
                target = target / "index.html"
            assert target.is_file(), f"Missing asset: {value}"


def main():
    Assets().feed((DASHBOARD / "index.html").read_text())
    data = json.loads((DASHBOARD / "data.json").read_text())
    assert data["totals"] == {"members": len(data["members"]), "notes": len(data["notes"]), "topics": len(data["topics"])}
    ids = {node["id"] for node in data["graph"]["nodes"]}
    assert all(edge["source"] in ids and edge["target"] in ids for edge in data["graph"]["edges"])
    for note in data["notes"]:
        assert (ROOT / note["path"]).is_file()
        if data["repository"]["url"]:
            assert note["url"].startswith(data["repository"]["url"] + "/blob/")
    print("Dashboard artifact: PASS", data["totals"])


if __name__ == "__main__":
    main()
