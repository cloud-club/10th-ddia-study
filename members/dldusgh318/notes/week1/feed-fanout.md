---
type: note
author: dldusgh318
created: 2026-11-02
status: draft
tags: [fanout, scalability, feed, tail-latency]
---

# SNS 피드 팬아웃: 트위터, 링크드인, 인스타그램은 어떻게 했을까

## 이번에 답하려는 질문

- 책에 나온 트위터의 혼합 방식은 실제로 어떻게 구현했고, 지금은 어떻게 바뀌었을까?
- 다른 SNS는 피드를 쓸 때 만들까(push), 볼 때 만들까(pull)? 왜 그렇게 골랐을까?
- 피드가 시간순에서 추천(랭킹) 피드로 바뀌면서 팬아웃 문제는 어떻게 달라졌을까?

## 한 줄 요약

트위터의 확장성 문제는 사용자가 서로 팔로우할 수 있다는 팬아웃 때문이다. 그래서 이를 구현할 때는 2가지 방식을 혼합했다.
그렇다면, 다른 기업들은 이와 비슷한 기능을 어떻게 구현하고 있을까?

## 핵심 내용

우선 트위터의 팬아웃 얘기에 대해 더 알아보자.

- 직접 조작해 보며 정리한 인터랙션 페이지: <https://claude.ai/artifact/E3MSkdBZ2UV2pobz3EQ6Pu>

### 핵심 개념: 피드를 만드는 두 가지 방법

| | pull (볼 때 모으기) | push (쓸 때 미리 넣기) |
| --- | --- | --- |
| 글 쓰기 | DB에 1건 저장 | 팔로워 수만큼 피드 캐시에 저장 |
| 피드 보기 | 팔로우한 계정 수만큼 조회 | 내 캐시 1번 조회 |

어느 쪽이든 비용은 생긴다. "쓰기 때 낼지, 읽기 때 낼지"를 고르는 문제다.

### 트위터 (2012): push + 대형 계정만 pull

- 피드 조회는 초당 약 30만 건, 글 작성은 초당 약 5천 건이었다. 조회가 압도적으로 많으니 조회를 싸게 만들고, 비용은 작성 쪽에서 내기로 했다.
- push 비용을 줄인 방법
  - 피드 캐시에는 글 본문이 아니라 글 ID, 작성자 ID, 플래그만 저장
  - 사용자마다 최근 800개만 유지
  - 30일 안에 로그인한 활성 사용자만 캐시 유지
  - Redis(메모리)에 저장하고 3대에 복제 → 조회 중앙값 약 5ms
  - 캐시는 파생 데이터라서 날아가도 팔로우 관계 + 원본 글로 다시 만들 수 있음
- 남은 문제: 팔로워가 수천만 명인 계정은 글 하나에 캐시 수천만 개를 써야 한다. 팔로워 100만 명 기준 반영 시간이 중앙값 약 3.5초, p99는 최대 5분이었다.
- 그래서 대형 계정은 push하지 않고, 피드를 볼 때 따로 가져와 합치는 혼합 방식을 계획했다.

### 트위터 (2023): 추천 피드에서는 문제가 바뀐다

"For You" 피드는 팔로우하지 않은 계정 글도 보여준다. 그래서 "이 글을 누구에게 보낼까"가 아니라 "수많은 후보 중 무엇을 보여줄까"가 문제가 된다.

1. 후보 수집: 팔로우한 계정 글(검색 인덱스 Earlybird, 노출 글의 약 50%) + 팔로우하지 않은 계정 글(상호작용 그래프 등)
2. 피처 수집: 점수 계산용 데이터 약 6000종
3. 랭킹: 가벼운 모델(light ranker)로 먼저 거르고, 무거운 모델(heavy ranker)은 남은 후보에만
4. 필터: 이미 본 글, 차단·뮤트 제거, 작성자 다양성 조정
5. 랭킹이 실패하면 시간순 피드로 대체

비싼 모델을 모든 글에 돌릴 수 없으니, 단계마다 후보 수를 줄이는 게 핵심이다.

### 링크드인 (2016): pull을 골랐다

- push로 실험해 보니 데이터 크기가 pull의 **62배**였다.
- 피드가 관련도 순이라, push면 랭킹 모델을 바꿀 때마다 저장된 피드를 전부 다시 정렬해야 한다. pull은 볼 때 점수를 계산하니 모델 변경이 바로 반영되고 A/B 테스트가 쉽다.
- pull을 빠르게 만든 방법
  - 글을 작성자 기준으로 720개 파티션에 나눠 저장(RocksDB)
  - 브로커가 필요한 서버들에 동시에 요청하고, **각 서버가 직접 점수를 계산해 상위 N개만** 돌려준다
  - 결과: 피드 p99 지연 5배 감소, 서버 수 절반
- pull의 약점은 **가장 느린 서버를 기다려야 한다**는 것이다. 동시에 묻는 서버가 많을수록 그중 한 대는 느릴 확률이 높아진다(꼬리 지연). 그래서 150ms 안에 응답이 없으면 같은 데이터를 가진 다른 복제본에도 요청한다.
- 2018년 부하 테스트에서는 요청의 10%가 빈 결과, 40%가 일부 누락된 피드를 받았다. 원인과 수정은 다음과 같다.
  - 요청 큐가 너무 김(5000) → 500으로 줄임
  - 느린 서버에 재시도가 몰림 → 서버별 재시도 제한
  - 클라이언트는 400ms에 포기하는데 서버는 3.5초까지 처리 → 타임아웃을 맞춤
  - 서버 쪽 요청 제한 없음 → 한도를 넘으면 429로 거절

### 인스타그램: 홈 피드 방식은 공개되지 않았다

- 2016년에 시간순에서 랭킹 피드로 바꿨다. 사용자들이 피드 글의 약 70%를 못 보고 지나쳤기 때문이다.
- 후보는 팔로우한 계정들의 최근 글이고, 사용자가 볼지·댓글을 달지·좋아요를 누를지 등을 예측해서 순서를 정한다.
- push/pull 중 무엇인지는 공식 자료에서 찾지 못했다. "트위터처럼 혼합"이라는 설명은 2차 자료뿐이다.
- 탐색 탭(Explore)은 트위터 For You와 비슷한 깔때기 구조다: 후보 수집 → 가벼운 랭킹(수천 개 → 100개) → 무거운 랭킹 → 최종 조정. 글 쪽 임베딩을 미리 계산해 캐시하고, 일부 추천은 트래픽이 적은 시간에 미리 계산한다.

### 정리

| | 트위터 (2012) | 링크드인 (2016) |
| --- | --- | --- |
| 방식 | push (+ 대형 계정만 pull) | pull |
| 선택 이유 | 조회가 작성보다 약 60배 많음 | 저장 공간 62배, 랭킹을 조회 시점에 계산 |
| 비용이 큰 쪽 | 작성 (대형 계정) | 조회 (여러 서버에 동시 요청) |
| 대표 문제 | 대형 계정 글 반영 p99 최대 5분 | 느린 서버 하나가 전체 응답을 늦춤 |
| DDIA 2장 연결 | 미리 합쳐 둔 데이터 (지역성) | 조회 시점에 합치기 (조인) |

정답은 없고, 부하 모양(조회/작성 비율, 팔로워 분포)과 요구사항(실시간성, 랭킹)에 따라 어디서 비용을 낼지가 달라진다. 1장에서 "부하를 서비스에 맞는 매개변수로 기술하라"고 한 이유가 이것 같다.

## 남은 질문

- 두 회사가 반대 방식을 고른 결정적 이유는 서비스 요구사항(실시간성 vs 랭킹)일까, 부하 모양일까?
- 피드가 랭킹 기반이 되면서 push/pull 논쟁은 사라졌을까, 아니면 후보 수집 단계 안으로 옮겨갔을까?
- 인스타그램 홈 피드는 실제로 push일까 pull일까?
- 결함 예방 vs 내결함성: 카오스 몽키 같은 방식이 작은 서비스에도 의미가 있을까? (8장에서 다시)

## 참고 자료

- 마틴 클레프만, 『데이터 중심 애플리케이션 설계』 1장 "부하 기술하기"
- [Timelines at Scale - Raffi Krikorian (InfoQ, 2012)](https://www.infoq.com/presentations/Twitter-Timeline-Scalability/)
- [The Architecture Twitter Uses To Deal With 150M Active Users (HighScalability, 위 발표 정리)](http://highscalability.com/blog/2013/7/8/the-architecture-twitter-uses-to-deal-with-150m-active-users.html)
- [twitter/the-algorithm - home-mixer README](https://github.com/twitter/the-algorithm/blob/main/home-mixer/README.md)
- [FollowFeed: LinkedIn's Feed Made Faster and Smarter (2016)](https://www.linkedin.com/blog/engineering/feed/followfeed-linkedin-s-feed-made-faster-and-smarter)
- [Making LinkedIn's organic feed handle peak traffic (2018)](https://www.linkedin.com/blog/engineering/optimization/making-linkedin-s-organic-feed-handle-peak-traffic)
- [Shedding More Light on How Instagram Works (Instagram, 2021)](https://about.instagram.com/blog/announcements/shedding-more-light-on-how-instagram-works)
- [Scaling the Instagram Explore recommendations system (Meta Engineering, 2023)](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/)
