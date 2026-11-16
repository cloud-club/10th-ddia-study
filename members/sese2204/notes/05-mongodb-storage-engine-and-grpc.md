---
type: note
author: sese2204
created: 2026-11-16
status: draft
tags: [storage, b-tree, lsm-tree, mongodb, wiredtiger, rpc, grpc, encoding]
---

# 05. MongoDB 저장소 엔진과 gRPC를 쓰는 이유

## 이번에 답하려는 질문

- MongoDB의 저장소 엔진은 3장의 두 계열 중 어느 쪽이고, 왜 그렇게 골랐나?
- 4장은 RPC의 단점을 여럿 드는데, MSA에서는 왜 gRPC로 다른 서비스를 호출하나?

## 한 줄 요약

MongoDB는 동시성과 압축 때문에 엔진을 WiredTiger(B 트리 계열)로 바꿨고, gRPC는 HTTP를 버리는 게 아니라 HTTP/2 위에서 스키마 계약과 이진 부호화를 얻으려고 같은 조직의 서비스끼리 쓴다.

## 핵심 내용

### 1. MongoDB는 B 트리 계열이다

MongoDB 3.2부터 기본 엔진은 WiredTiger이고, 컬렉션과 색인을 모두 B 트리로 저장한다.

| | MMAPv1 (3.0까지 기본) | WiredTiger (3.2부터 기본) |
|---|---|---|
| 구조 | 메모리 맵 파일 + B 트리 색인 | B 트리, 한 번 쓴 블록은 덮어쓰지 않음 |
| 잠금 단위 | 컬렉션 (3.0 전에는 데이터베이스) | 도큐먼트 |
| 압축 | 없음 | 컬렉션은 snappy 블록 압축, 색인은 접두사 압축이 기본 |
| 장애 복구 | 저널 | 저널(WAL) + 60초마다 체크포인트 |
| 현재 | 4.0에서 deprecated, 4.2에서 제거 | 사실상 유일한 디스크 엔진 |

### 2. MMAPv1에서 WiredTiger로 바꾼 이유

MongoDB가 문서에서 내세우는 WiredTiger의 특징이 곧 MMAPv1의 약점이었다.

- **동시성**: MMAPv1은 컬렉션 단위로 잠가서, 한 도큐먼트를 쓰는 동안 같은 컬렉션의 다른 쓰기가 기다렸다. WiredTiger는 도큐먼트 단위 동시성 제어라 여러 클라이언트가 한 컬렉션의 다른 도큐먼트를 동시에 고친다.
- **압축**: MMAPv1은 압축이 없었다. WiredTiger는 컬렉션과 색인을 모두 압축한다. CPU를 더 쓰는 대신 저장 공간을 줄인다.
- **체크포인트**: 60초마다 일관된 스냅숏을 디스크에 쓰고, 체크포인트 사이 구간은 저널을 재생해 복구한다.

### 3. LSM이 아니라 B 트리인 이유 (내 추론)

MongoDB가 "LSM 대신 B 트리를 골랐다"고 이유를 밝힌 문서는 찾지 못했다. 아래는 책의 비교표를 MongoDB의 쓰임에 대입한 내 추론이다.

- **보조 색인이 많은 범용 워크로드**: MongoDB는 필드마다 색인을 자유롭게 걸고, 색인 하나가 B 트리 하나다. 읽기와 범위 질의가 섞인 일반 서비스에는 읽기 지연이 예측 가능한 B 트리가 무난하다.
- **컴팩션 부담이 없다**: LSM은 컴팩션이 밀리면 읽기·쓰기 지연이 튄다. 범용 DB의 기본값으로는 다루기 까다롭다.
- **트랜잭션**: 키가 한 곳에만 있어서 도큐먼트 단위 동시성 제어와 스냅숏을 붙이기 쉽다.

참고로 WiredTiger 라이브러리에는 LSM 트리 모드(`type=lsm`)도 있었다. 하지만 WiredTiger 문서 스스로 "몇 년간 운영 환경에서 개발·검증되지 않은 실험적 코드"라고 경고했고, MongoDB의 엔진 문서에도 LSM 설정은 나오지 않는다.

### 4. 책의 B 트리와 다른 점

책의 B 트리는 페이지를 **제자리에서 덮어쓰고**, 덮어쓰다 죽는 경우에 대비해 WAL을 둔다. WiredTiger는 조금 다르다.

- **블록을 덮어쓰지 않는다.** WiredTiger 문서 표현으로 "no-overwrite" 엔진이다. 페이지가 바뀌면 파일의 새 위치에 새 블록으로 쓴다. 덮어쓰다 죽으면 블록 상태를 알 수 없게 되기 때문이다. 책에 나오는 **쓰기 시 복사 B 트리**에 가깝다.
- **그래도 WAL(저널)을 쓴다.** 체크포인트가 60초 간격이라 그 사이의 쓰기를 지키려는 것이다. 저널은 기본 100ms마다 디스크에 동기화한다.

색인 구조도 책의 용어로 대응시킬 수 있다.

- 기본 컬렉션은 **클러스터드 색인이 아니다.** 도큐먼트는 내부 식별자(RecordId) 순서로 저장되고, `_id` 색인은 `_id`에서 RecordId를 찾는 별도의 B 트리다. 책에서 말한 "색인이 로우 위치를 가리키는" 구조다.
- 5.3부터는 `_id` 순서대로 도큐먼트를 저장하는 **클러스터드 컬렉션**을 선택할 수 있다.

### 5. 쓰기가 압도적으로 많으면 LSM을 끼우기도 했다

3.0에서 저장소 엔진을 갈아 끼울 수 있는 API가 생겼다. 이 API로 RocksDB(LSM 트리)를 MongoDB 아래에 붙인 엔진이 MongoRocks다. "쓰기 처리량과 압축률은 LSM"이라는 책의 구도가 같은 DB 안에서 그대로 드러난 사례다.

### 6. 책이 비판하는 건 RPC가 아니라 "로컬 함수인 척"이다

책이 든 RPC의 문제는 이렇다.

- 타임아웃이 나면 요청이 처리됐는지 알 수 없다.
- 재시도하면 같은 동작이 여러 번 실행될 수 있다.
- 지연 시간이 들쭉날쭉하다.
- 인자를 전부 바이트열로 부호화해야 한다.

이건 **네트워크를 건너는 호출이면 다 겪는 문제**다. REST로 불러도 타임아웃은 나고 재시도는 중복된다. 책이 겨냥한 건 이 차이를 감추고 원격 호출을 로컬 함수 호출처럼 보이게 만드는 설계(위치 투명성)다.

gRPC 같은 요즘 프레임워크는 원격 호출임을 감추지 않는다. 데드라인, 취소, 상태 코드가 API에 그대로 드러난다.

### 7. gRPC는 HTTP를 대체하지 않는다

gRPC는 **HTTP/2 위에서 돈다.** 대체하는 대상은 HTTP가 아니라 "HTTP/1.1 + JSON + REST" 조합이다.

| | REST + JSON | gRPC |
|---|---|---|
| 계약 | OpenAPI 문서(선택 사항) | `.proto` 스키마(필수), 여러 언어의 클라이언트·서버 코드 자동 생성 |
| 부호화 | 텍스트, 필드 이름을 매번 실음 | 이진(프로토콜 버퍼), 태그 번호만 실음 |
| 전송 | 보통 HTTP/1.1, 연결 하나에 요청 하나씩 | HTTP/2, 연결 하나에 여러 요청을 다중화 |
| 스트리밍 | 별도 수단 필요(SSE, 웹소켓) | 서버·클라이언트·양방향 스트리밍 내장 |
| 타임아웃 | 클라이언트마다 제각각 | 데드라인을 호출에 실어 보냄 |
| 디버깅 | curl로 바로 확인 | 전용 도구 필요 |
| 브라우저 | 바로 호출 | 프록시 필요(gRPC-Web) |

### 8. MSA 내부에서 gRPC를 고르는 이유

- **스키마가 계약이 된다.** 서비스가 수십 개면 "이 필드가 문자열인지 숫자인지"를 문서로 맞추기 어렵다. `.proto`에서 코드를 생성하면 타입이 안 맞을 때 컴파일에서 걸린다. 4장의 태그 번호 규칙 덕분에 신·구 버전이 섞여도 호환된다.
- **호출이 많아서 비용 차이가 쌓인다.** 사용자 요청 하나가 내부 호출 수십 번으로 퍼지면, JSON 파싱과 연결 관리 비용이 지연에 그대로 더해진다.
- **데드라인을 다음 서비스로 넘길 수 있다.** A → B → C로 이어지는 호출에서 A가 정한 데드라인을 B가 C에게 그대로 물려주면, A가 이미 포기한 요청을 C가 계속 처리하는 낭비가 줄어든다. 자동 전파는 구현마다 다르다(Java·Go는 기본, C++은 켜야 함).
- **양쪽을 같은 조직이 관리한다.** 책도 RPC는 같은 조직, 같은 데이터센터 안의 서비스 간 요청에 주로 쓰인다고 한다. 클라이언트를 강제로 업그레이드할 수 없는 공개 API는 REST가 여전히 주류다.

그래서 흔한 구성이 **외부는 REST, 내부는 gRPC**다. 게이트웨이가 JSON을 받아 내부 gRPC 호출로 바꾼다.

gRPC가 해결하지 못하는 것도 있다. **멱등성은 여전히 내가 설계해야 한다.** 데드라인이 지났다고 해서 서버가 그 요청을 처리하지 않았다는 보장은 없다.

### 9. 주의: 쿠버네티스에서 gRPC는 한 파드에 몰린다

쿠버네티스의 기본 Service는 **연결 단위**로 분산한다. HTTP/1.1은 연결 하나에 요청 하나씩이라 동시 요청을 하려면 연결을 여러 개 맺고, 연결이 자주 끊겼다 새로 생겨서 연결 단위 분산으로도 충분했다.

gRPC는 HTTP/2 연결 하나를 오래 유지하며 그 안에서 모든 요청을 다중화한다. 연결이 한 번 맺어지면 더 분산할 기회가 없어서, 파드를 늘려도 요청이 한 파드에만 간다.

해결 방법은 요청 단위(L7)로 분산하는 것이다.

- 헤드리스 Service로 파드 IP를 DNS에 노출하고, gRPC 클라이언트가 직접 여러 파드에 나눠 보낸다.
- 서비스 메시(Linkerd, Istio)의 사이드카 프록시가 요청 단위로 분산한다.

## 남은 질문

- WiredTiger는 블록을 덮어쓰지 않으니 예전 블록이 남는데, 그 공간은 언제 어떻게 다시 쓰나? LSM의 컴팩션과 비슷한 비용이 숨어 있나?
- 클러스터드 컬렉션을 쓰면 `_id` 조회가 B 트리 한 번으로 끝날 텐데, 왜 기본값이 아닌가?
- 실습 클러스터에 gRPC 서버를 파드 3개로 띄우고 기본 Service로 호출하면 정말 한 파드에만 몰리는지 확인해 보고 싶다.
- gRPC 필드를 삭제한 뒤 그 태그 번호를 다른 필드에 다시 쓰면 구버전 서비스에서 어떤 일이 생기나?

## 참고 자료

- 『데이터 중심 애플리케이션 설계』 3장 "B 트리", "B 트리와 LSM 트리 비교" 절, 4장 "서비스를 통한 데이터플로: REST와 RPC" 절
- [WiredTiger Storage Engine — MongoDB Manual](https://www.mongodb.com/docs/manual/core/wiredtiger/) — 도큐먼트 단위 동시성, 60초 체크포인트, 압축 기본값
- [Journaling — MongoDB Manual](https://www.mongodb.com/docs/manual/core/journaling/) — 저널 동기화 주기
- [Clustered Collections — MongoDB Manual](https://www.mongodb.com/docs/manual/core/clustered-collections/)
- [Block Manager — WiredTiger 문서](https://source.wiredtiger.com/develop/arch-block.html) — 블록을 덮어쓰지 않는 이유
- [Log-Structured Merge Trees — WiredTiger 11.3.0 문서](https://source.wiredtiger.com/11.3.0/lsm.html) — LSM 모드와 실험적 코드 경고
- [mongo-rocks](https://github.com/mongodb-partners/mongo-rocks) — RocksDB 저장소 엔진
- [Core concepts, architecture and lifecycle — gRPC](https://grpc.io/docs/what-is-grpc/core-concepts/)
- [Deadlines — gRPC](https://grpc.io/docs/guides/deadlines/) — 데드라인 전파
- [gRPC Load Balancing on Kubernetes without Tears — Kubernetes Blog](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/)
