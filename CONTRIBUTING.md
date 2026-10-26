# CONTRIBUTING

## 노트 위치

각자 본인 GitHub ID 폴더 아래에만 노트를 추가합니다.

```text
members/<github-id>/
└── notes/
    ├── 01-storage-and-retrieval.md
    └── chapter-03/
        └── 02-storage-engines.md
```

- 파일 하나에는 질문 또는 개념 하나를 정리합니다.
- 파일명은 읽기 순서를 위한 두 자리 번호와 소문자 kebab-case를 사용합니다.
- 챕터 폴더나 더 깊은 하위 폴더도 가능합니다.
- 다른 사람의 폴더는 직접 수정하지 않습니다. 제안은 PR 코멘트로 남깁니다.
- 필요하면 본인 폴더의 `README.md`에 소개나 노트 목차를 추가할 수 있습니다. 대시보드 집계에는 `notes/` 아래 Markdown만 포함됩니다.

## 노트 메타데이터

[`templates/note-template.md`](templates/note-template.md)를 복사하고 아래 규칙을 지킵니다.

```yaml
---
type: note
author: github-id
created: YYYY-MM-DD
status: draft
tags: []
---
```

- `author`는 `members/<github-id>/`의 ID와 같아야 합니다.
- `created`는 노트를 처음 작성한 날짜(`YYYY-MM-DD`)입니다.
- `status`는 `draft` 또는 `completed` 중 하나입니다.
- `tags`는 소문자 영문 YAML 목록입니다. 아직 정하지 않았다면 `tags: []`로 둡니다.
- 제목은 본문의 첫 `# 제목`에서 읽습니다. `## 한 줄 요약` 아래 첫 문단은 대시보드 카드에 표시됩니다.

## PR 제출

```bash
GH_ID="your-github-id" # 실제 GitHub ID로 변경
TOPIC="storage-and-retrieval"
git switch -c "${GH_ID}/${TOPIC}"
# members/${GH_ID}/notes/ 아래에서 노트 작성
python3 scripts/validate_study.py
python3 -m unittest discover -s scripts -p 'test_*.py' -v
git add "members/${GH_ID}/notes"
git commit -m "docs: add ${TOPIC} note"
git push -u origin "${GH_ID}/${TOPIC}"
```

PR은 `main`을 대상으로 올립니다. `main`에 직접 커밋하지 않습니다. 각 PR은 본인 노트와 그 노트가 사용하는 파일만 포함합니다.

## 공개·개인정보 주의

- DDIA 책의 원문, 전자책, 스캔본 또는 긴 발췌문을 저장소에 올리지 않습니다.
- 회사/개인 비공개 자료, 이메일·전화번호, 대화 내용, 자격 증명, `.env` 파일을 커밋하지 않습니다.
- 비공개 사례를 이름만 바꿔 공개하는 것도 허용되지 않습니다. 노트에는 공개 정보나 직접 만든 일반 예시를 사용합니다.
- Git에 한 번 들어간 정보는 후속 삭제만으로 기록에서 제거되지 않습니다. 민감정보가 포함된 것 같으면 PR을 진행하지 말고 스터디 운영자에게 먼저 알립니다.
