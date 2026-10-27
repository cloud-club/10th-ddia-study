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
- 필요하면 본인 폴더의 `README.md`에 소개나 노트 목차를 추가할 수 있습니다. 대시보드는 `notes/` 아래 메타데이터가 있는 Markdown(`.md`)과 HTML(`.html`, `.htm`)을 재귀적으로 집계합니다.

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

## 내부 리더와 HTML 노트

대시보드의 노트 링크는 `reader.html?note=<인코딩된 노트 ID>`로 열립니다. 원본 GitHub 링크는 별도의 `source_url`로 유지합니다. Markdown ID는 기존처럼 확장자를 제외하고, HTML ID는 `.html`/`.htm` 확장자를 유지하여 같은 이름의 Markdown과 충돌하지 않습니다.

HTML도 Markdown과 **동일한 필수 메타데이터**를 사용합니다. 파일 맨 처음에 아래 HTML 주석으로 감쌉니다. HTML은 `title`과 `summary`를 지정하면 카드에 사용합니다.

```html
<!--
---
type: note
author: github-id
created: 2026-10-27
status: draft
tags: []
title: 저장소 엔진
summary: 저장 구조의 차이를 설명합니다.
---
-->
<!doctype html>
<html lang="ko"><body><h1>저장소 엔진</h1></body></html>
```

검증기는 `notes/` 아래 모든 `.md`, `.html`, `.htm`에 frontmatter를 요구합니다. 메타데이터 없는 보조 HTML은 카드로 집계하지 않지만 검증에 실패하므로, 노트로 공개할 HTML에는 메타데이터를 추가합니다. 리더의 `content`에는 frontmatter 또는 이를 감싼 최초 HTML 주석을 제거한 본문만 들어갑니다.

이미지·CSS·폰트는 노트 옆 `assets/` 등에 두고 상대경로로 연결합니다. 로컬 링크는 해당 멤버의 `notes/` 밖으로 벗어나면 안 됩니다. 경로의 공백·한글은 URL에서 인코딩되며, HTML의 `src`/`href`도 검증합니다.

```bash
python3 scripts/validate_study.py
python3 scripts/build_dashboard.py --repo-url https://github.com/cloud-club/ddia-study --branch main
python3 scripts/verify_dashboard.py
python3 -m http.server 8000 --directory dashboard
```

빌드는 `dashboard/data.json`과 `dashboard/content/members/<id>/notes/`를 생성하며 상대 디렉터리 구조를 보존합니다. `dashboard/content/`는 매 빌드마다 교체되므로 직접 수정하지 않습니다. Pages에는 생성된 `dashboard/` 전체가 필요합니다.

HTML/HTM은 메타데이터 주석만 제거한 원본을 배포합니다. 내부 읽기 화면은 해당 파일을 iframe으로 열며, **새 탭으로 열기**도 같은 원본 주소를 사용합니다. HTML의 스크립트·SVG·폼·로컬 저장소를 차단하지 않습니다. HTML은 대시보드와 같은 출처에서 실행되므로 신뢰할 수 있는 파일만 게시하고, PR에서 스크립트와 외부 통신도 검토합니다. Markdown의 안전한 렌더링은 별도로 유지됩니다.

공개 복사는 `.md`, `.html`, `.htm`, 이미지(`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`, `.ico`, `.bmp`), CSS와 폰트(`.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`)만 허용합니다. JavaScript(`.js`, `.mjs`)도 함께 복사합니다. 설정·데이터베이스 등은 복사하지 않습니다. `.`/`_`로 시작하는 경로와 `private`, `raw`, `data`, `exports`, `secrets`, `credentials`, `node_modules` 디렉터리 및 secret/credential/password/token 이름은 제외합니다. 심볼릭 링크는 파일·디렉터리 모두 거부합니다. 확장자 필터는 민감정보 검토를 대체하지 않습니다.

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
