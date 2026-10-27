# DDIA Study Notes

대시보드: https://cloud-club.github.io/10th-ddia-study/

**Designing Data-Intensive Applications (DDIA)** 스터디에서 각자 읽고 정리한 노트를 모으는 공간입니다. 참여자는 본인 GitHub ID 폴더에 Markdown 또는 HTML 노트를 추가하고, 대시보드에서 작성 현황과 주제를 함께 볼 수 있습니다.

## 노트 올리는 방법

1. `members/<github-id>/notes/` 아래에 `01-kebab-case-topic.md` 형식의 Markdown 또는 `.html`/`.htm` 파일을 만듭니다.
2. [`templates/note-template.md`](templates/note-template.md)를 복사하고 질문, 요약, 핵심 내용, 남은 질문, 참고 자료를 채웁니다.
3. `author`는 폴더명과 같은 GitHub ID로, `created`는 `YYYY-MM-DD`, `status`는 `draft` 또는 `completed`로 적습니다.
4. 커밋 전 `python3 scripts/validate_study.py`로 형식을 확인합니다.
5. 변경사항을 PR로 제출합니다. 상세 규칙은 [`CONTRIBUTING.md`](CONTRIBUTING.md)를 참고하세요.

```bash
GH_ID="your-github-id" # 실제 GitHub ID로 변경
mkdir -p "members/${GH_ID}/notes"
cp templates/note-template.md "members/${GH_ID}/notes/01-topic.md"
```

매주 안내된 범위를 읽고 자료 하나를 작성합니다. 질문·추가로 찾아본 내용·이해하기 어려웠던 점을 중심으로 남기고, 필요하면 `notes/1주차/`처럼 하위 폴더로 나눕니다. HTML 메타데이터 형식은 CONTRIBUTING을 참고하세요.

## 디렉터리 구조

```text
ddia-study/
├── README.md
├── CONTRIBUTING.md
├── members/
│   ├── README.md
│   └── <github-id>/
│       └── notes/
├── templates/
│   └── note-template.md
├── dashboard/                 # 정적 대시보드
├── scripts/
│   ├── build_dashboard.py     # 노트 → dashboard/data.json
│   ├── validate_study.py      # 메타데이터·로컬 링크 검사
│   └── test_*.py
└── .github/workflows/         # 검사 및 GitHub Pages 배포
```

## 대시보드 로컬 미리보기

빌더는 Python 표준 라이브러리만 사용합니다. 단위 테스트에는 Node.js 22+, 브라우저 회귀 검사에는 고정 버전 Playwright를 사용합니다.

```bash
python3 -m unittest discover -s scripts -p 'test_*.py' -v
python3 scripts/validate_study.py
python3 scripts/build_dashboard.py
python3 scripts/verify_dashboard.py
npm ci --include=dev
npm test
npx playwright install chromium
npm run test:browser
python3 -m http.server 4178
```

브라우저에서 <http://127.0.0.1:4178/dashboard/> 를 엽니다. 빌더는 `members/<id>/notes/`의 Markdown/HTML/HTM을 읽고 필요한 공개 자산을 `dashboard/content/`에 복사합니다. 별도 데모 옵션은 없습니다. 생성 데이터 `dashboard/data.json`은 Git에 올리지 않으며 CI에서 다시 빌드합니다.

`main`에 반영되면 [`.github/workflows/deploy-dashboard.yml`](.github/workflows/deploy-dashboard.yml)이 노트를 검사하고 GitHub Pages 대시보드를 빌드·배포합니다. PR에서도 단위·브라우저 테스트, 노트 검증, 빌드와 산출물 검사를 실행하되 배포하지 않습니다. CI는 `npm ci`와 잠금 파일로 브라우저 테스트 의존성을 설치합니다.

## 공개 저장소 안전 수칙

- 책 원문·전자책·스캔본, 사내/개인 문서, 대화 원문, 계정 정보, 토큰, 비밀번호를 커밋하지 않습니다.
- 본인이 작성한 요약과 직접 확인한 공개 참고자료 링크만 올립니다.
- `.gitignore`는 실수 방지용일 뿐입니다. 민감한 내용이 Git 기록에 들어가면 나중에 파일을 지워도 기록에는 남을 수 있으므로, 올리기 전에 PR 내용을 확인합니다.

## 지식 그래프

대시보드는 KG 스터디 현황판의 중계석·D3 네트워크·멤버 카드·최근 활동 구성을 사용합니다. 노트에서 확인되는 **작성자 → 노트 → 주제 태그**를 노드와 관계로 표시합니다. `작성` 관계는 노트가 들어 있는 참여자 폴더를, `태그` 관계는 frontmatter의 `tags`를 근거로 생성합니다. 같은 태그를 가진 노트가 같은 주제 노드에 연결됩니다. 태그의 동시 등장만으로 개념 간 인과·포함·의존 관계를 추론하지 않습니다.

노드를 선택하면 연결된 노트와 원문 링크를 확인할 수 있습니다. 검색·참여자·태그 필터는 목록과 그래프에 함께 적용됩니다.

시각 디자인은 [DDIA 표지](https://dataintensive.net/)의 붉은색·종이색·흑백 판화 질감을 참고한 독자적인 화면이며, 표지 삽화를 복제하지 않습니다.

## 집계 기준

- 중계석·최근 활동: 노트의 작성일과 요약을 사용하며, 커밋이나 실시간 제출 기록이 아닙니다.
- 멤버 XP: 노트 한 편당 40 XP, 100 XP마다 레벨 상승입니다. 스터디의 공식 평가 기준이 아니라 현황판 표시용입니다.
- 활동 히트맵: frontmatter의 `created` 날짜별 노트 수입니다. Git 커밋 횟수나 출석이 아닙니다.
- 아직 수집하지 않는 실습·커밋·출석·반 편성은 수치나 기록을 만들어 넣지 않습니다.

## 참여 현황

참여자별 노트가 추가되면 대시보드가 폴더와 프론트매터를 읽어 자동으로 집계합니다. 테스트용 참여자와 노트는 제거된 상태로 시작합니다.
