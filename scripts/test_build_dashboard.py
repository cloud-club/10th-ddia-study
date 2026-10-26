from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_dashboard


class BuildDashboardTests(unittest.TestCase):
    def test_indexes_nested_notes_by_member_and_topic(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note_dir = root / "members" / "alice" / "notes" / "replication"
            note_dir.mkdir(parents=True)
            (note_dir / "02-replication.md").write_text(
                "---\n"
                "type: note\n"
                "author: alice\n"
                "created: 2026-10-24\n"
                "status: completed\n"
                "tags:\n"
                "  - replication\n"
                "  - consistency\n"
                "---\n\n"
                "# 복제와 일관성\n\n"
                "## 한 줄 요약\n\n"
                "복제본 사이의 지연과 일관성 보장은 별개의 문제다.\n\n"
                "## 핵심 내용\n\n"
                "본문은 대시보드 요약에 들어가지 않는다.\n",
                encoding="utf-8",
            )
            (note_dir / ".draft.md").write_text("# 숨긴 노트\n", encoding="utf-8")
            hidden = root / "members" / "alice" / "notes" / "_private"
            hidden.mkdir()
            (hidden / "secret.md").write_text("# 숨긴 노트\n", encoding="utf-8")

            data = build_dashboard.build_dashboard_data(
                root,
                repo_url="https://github.com/cloud-club/ddia-study",
                branch="main",
                generated_at="2026-10-24T00:00:00+00:00",
            )

            self.assertEqual(data["totals"], {"members": 1, "notes": 1, "topics": 2})
            self.assertEqual(len(data["members"]), 1)
            self.assertEqual(data["members"][0]["id"], "alice")
            self.assertEqual(data["members"][0]["note_count"], 1)
            self.assertEqual(len(data["notes"]), 1)
            note = data["notes"][0]
            self.assertEqual(note["title"], "복제와 일관성")
            self.assertEqual(note["summary"], "복제본 사이의 지연과 일관성 보장은 별개의 문제다.")
            self.assertEqual(note["tags"], ["replication", "consistency"])
            self.assertEqual(note["status"], "completed")
            self.assertEqual(note["url"], "https://github.com/cloud-club/ddia-study/blob/main/members/alice/notes/replication/02-replication.md")
            self.assertEqual(data["generated_at"], "2026-10-24T00:00:00+00:00")

    def test_empty_study_builds_valid_empty_dashboard_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "members").mkdir()

            data = build_dashboard.build_dashboard_data(root, generated_at="2026-10-24T00:00:00+00:00")

            self.assertEqual(data["totals"], {"members": 0, "notes": 0, "topics": 0})
            self.assertEqual(data["members"], [])
            self.assertEqual(data["notes"], [])
            self.assertEqual(data["topics"], [])
            self.assertEqual(json.loads(json.dumps(data, ensure_ascii=False)), data)

    def test_demo_mode_includes_example_note_without_changing_default_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            examples = root / "examples"
            examples.mkdir()
            (examples / "sample-note.md").write_text(
                "---\n"
                "type: note\n"
                "author: example\n"
                "created: 2026-10-24\n"
                "status: completed\n"
                "tags:\n"
                "  - replication\n"
                "  - consistency\n"
                "---\n\n"
                "# 복제본 지연과 읽기 일관성\n\n"
                "## 한 줄 요약\n\n"
                "비동기 복제에서는 쓰기 직후 다른 복제본에서 이전 값을 읽을 수 있다.\n",
                encoding="utf-8",
            )

            default_data = build_dashboard.build_dashboard_data(root, generated_at="2026-10-24T00:00:00+00:00")
            demo_data = build_dashboard.build_dashboard_data(
                root, include_demo=True, generated_at="2026-10-24T00:00:00+00:00"
            )

            self.assertEqual(default_data["totals"], {"members": 0, "notes": 0, "topics": 0})
            self.assertEqual(demo_data["totals"], {"members": 1, "notes": 1, "topics": 2})
            self.assertEqual(demo_data["notes"][0]["member"], "example")
            self.assertEqual(demo_data["notes"][0]["url"], "../examples/sample-note.md")
            self.assertEqual(demo_data["notes"][0]["title"], "복제본 지연과 읽기 일관성")

    def test_demo_discovers_additional_examples_without_polluting_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "examples" / "chapter-07"
            folder.mkdir(parents=True)
            (folder / "isolation.md").write_text(
                "---\ntype: note\nauthor: example\ncreated: 2026-10-24\nstatus: draft\ntags: [consistency]\n---\n# 격리 수준\n",
                encoding="utf-8",
            )
            default = build_dashboard.build_dashboard_data(root)
            demo = build_dashboard.build_dashboard_data(root, include_demo=True)
            self.assertEqual(default["notes"], [])
            self.assertEqual(demo["notes"][0]["id"], "example/chapter-07/isolation")
            self.assertEqual(demo["notes"][0]["url"], "../examples/chapter-07/isolation.md")
            self.assertTrue(demo["preview"])
            self.assertFalse(default["preview"])
            self.assertEqual(default["graph"], {"nodes": [], "edges": []})

    def test_member_progress_feed_and_sources_come_from_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "members" / "alice" / "notes"
            folder.mkdir(parents=True)
            (folder / "01-note.md").write_text(
                "---\ntype: note\nauthor: alice\ncreated: 2026-10-24\nstatus: completed\ntags: [replication]\n---\n"
                "# 복제\n\n## 한 줄 요약\n\n복제 지연을 구분한다.\n\n## 참고 자료\n\n"
                "- [DDIA](https://dataintensive.net/)\n- Martin Kleppmann, DDIA Chapter 5\n",
                encoding="utf-8",
            )
            data = build_dashboard.build_dashboard_data(root)
            member = data["members"][0]
            self.assertEqual(member["xp"], 40)
            self.assertEqual(member["level"], 1)
            self.assertEqual(member["xp_in_level"], 40)
            self.assertEqual(member["activity"], [{"date": "2026-10-24", "count": 1}])
            self.assertEqual(data["feed"][0]["title"], "복제")
            self.assertEqual(data["feed"][0]["date"], "2026-10-24")
            self.assertEqual(data["readings"][0], {"title": "DDIA", "url": "https://dataintensive.net/", "note_count": 1})
            self.assertEqual(data["readings"][1]["title"], "Martin Kleppmann, DDIA Chapter 5")
            self.assertIsNone(data["readings"][1]["url"])

    def test_graph_uses_only_observed_authorship_and_tags(self) -> None:
        notes = [
            {"id": "alice/one", "member": "alice", "title": "복제", "url": "../one.md", "tags": ["replication", "consistency"]},
            {"id": "bob/two", "member": "bob", "title": "트랜잭션", "url": "../two.md", "tags": ["consistency"]},
        ]
        graph = build_dashboard.build_graph(notes)
        nodes = {node["id"]: node for node in graph["nodes"]}
        self.assertEqual(len(nodes), 6)
        self.assertEqual(len(graph["edges"]), 5)
        self.assertEqual(nodes["note:alice/one"]["url"], "../one.md")
        self.assertEqual(nodes["topic:consistency"]["type"], "topic")
        edges = {(e["source"], e["target"], e["type"]) for e in graph["edges"]}
        self.assertIn(("member:alice", "note:alice/one", "authored"), edges)
        self.assertIn(("note:bob/two", "topic:consistency", "tagged"), edges)
        self.assertTrue(all(e["source"] in nodes and e["target"] in nodes for e in graph["edges"]))
        self.assertFalse(any(nodes[e["source"]]["type"] == nodes[e["target"]]["type"] for e in graph["edges"]))
        self.assertEqual(build_dashboard.build_graph([]), {"nodes": [], "edges": []})

    def test_local_note_links_are_relative_to_dashboard_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note_dir = root / "members" / "bob" / "notes"
            note_dir.mkdir(parents=True)
            (note_dir / "01-storage.md").write_text(
                "---\ntype: note\nauthor: bob\ncreated: 2026-10-24\nstatus: draft\ntags: []\n---\n\n# 저장소\n",
                encoding="utf-8",
            )

            data = build_dashboard.build_dashboard_data(root, generated_at="2026-10-24T00:00:00+00:00")

            self.assertEqual(data["notes"][0]["url"], "../members/bob/notes/01-storage.md")


if __name__ == "__main__":
    unittest.main()
