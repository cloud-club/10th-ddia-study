---
type: note
author: dldusgh318
created: 2026-11-09
status: draft
tags: [storage-engine, lsm-tree, b-tree, myrocks, compaction]
---

# MyRocks: InnoDB에서 LSM 트리로 옮긴 회사들은 무엇을 얻고 무엇을 잃었나

- 직접 눌러보며 정리한 인터랙션 페이지: <https://claude.ai/artifact/AzXi9QcpZ9tUzSTQYp3cfC>

## 이번에 답하려는 질문

- 3장에서 본 B 트리와 LSM 트리의 트레이드오프가 실제 서비스에서는 어떻게 나타났을까?
- 메타와 우버는 왜 InnoDB(B 트리)를 버리고 MyRocks(LSM 트리)로 옮겼을까?
- 옮기면서 무엇을 포기했고, 어떤 문제를 겪었을까?

## 한 줄 요약

메타와 우버 모두 디스크 공간이 병목이라 MyRocks로 옮겼고, 공간과 쓰기량은 크게 줄었다. 대신 범위 스캔이 느려지고, 툼스톤과 컴팩션을 직접 관리해야 했고, 갭 락이나 외래 키 같은 InnoDB 기능을 포기했다.

## 핵심 내용

### 핵심 개념: MyRocks가 뭔가

MySQL은 SQL을 해석하는 부분과 실제로 데이터를 디스크에 읽고 쓰는 부분(저장 엔진)이 나뉘어 있다. 기본 저장 엔진은 InnoDB(B 트리)이고, MyRocks는 이 자리에 RocksDB(LSM 트리)를 넣은 저장 엔진이다.

```sql
CREATE TABLE users (...) ENGINE=InnoDB;   -- 기본값, B 트리
CREATE TABLE users (...) ENGINE=ROCKSDB;  -- MyRocks, LSM 트리
```

SQL과 애플리케이션 코드는 거의 그대로 두고, 저장 방식만 바뀐다. 페이스북(메타)이 만들어서 2016년에 오픈소스로 공개했고, 지금은 Percona Server와 MariaDB에 들어 있다.

### 용어 정리

| 용어 | 뜻 |
|---|---|
| 페이지 | InnoDB가 디스크에 쓰는 단위(16KB). 행 하나만 바뀌어도 페이지 전체를 다시 쓴다 |
| 쓰기 증폭 | 실제로 바꾼 양보다 디스크에 더 많이 쓰는 것. SSD는 쓸 수 있는 총량이 정해져 있어서 중요하다 |
| 컴팩션 | LSM에서 쌓인 파일을 합치며 키마다 최신 값만 남기는 작업 |
| 툼스톤 | LSM에서 "이 키는 삭제됨"을 나타내는 표시. 파일을 고치지 않으니 삭제도 표시를 새로 쓴다 |
| 범위 스캔 | `WHERE user_id = 7 ORDER BY created_at`처럼 키 구간을 이어서 읽는 조회 |
| 블룸 필터 | 파일마다 붙은 작은 비트 배열. "이 파일엔 그 키가 확실히 없다"를 빠르게 판정한다 |
| 갭 락 | InnoDB가 REPEATABLE READ에서 행 사이 빈 구간까지 잠그는 것 |

### 왜 옮겼나 ①: 쓰기량

InnoDB는 행 하나만 바꿔도 그 행이 있는 16KB 페이지 전체를 다시 쓴다. 페이지가 깨지는 걸 막으려고 doublewrite로 한 번 더 쓰기도 한다. 반면 LSM은 변경 내용을 메모리(멤테이블)에 모았다가 한 번에 순차로 내려쓴다.

메타 논문 기준으로 MyRocks로 바꾼 뒤 디스크에 쓴 양이 **75% 줄었다.** IOPS 한계에 덜 걸렸고, 쓰기 수명이 짧은 더 싼 SSD도 쓸 수 있게 됐다.

### 왜 옮겼나 ②: 압축해도 공간이 덜 줄어드는 이유

InnoDB에도 압축 기능이 있고, 메타는 이미 켜서 약 40%를 줄였다. 그런데도 MyRocks가 훨씬 작았다. 차이는 압축률이 아니라 **압축한 데이터를 디스크에 어떻게 놓느냐**에서 나온다.

1. 둘 다 데이터를 블록 단위로 압축한다. 16KB가 5KB, 3KB처럼 블록마다 다른 크기로 줄어든다.
2. **InnoDB**는 디스크를 미리 정한 크기의 칸(예: `KEY_BLOCK_SIZE=8`이면 8KB)으로 나눠두고, 압축된 블록을 칸 하나에 하나씩 넣는다. 5KB든 3KB든 8KB를 차지하고 나머지는 빈 공간이 된다.
3. **MyRocks**는 칸이 없어서 압축된 블록을 파일에 빈틈없이 이어 붙인다. 5KB면 5KB만 쓴다.

```
압축 결과: 5KB, 3KB, 7KB, 4KB

InnoDB  : [5KB|빈 3KB][3KB|빈 5KB][7KB|빈 1KB][4KB|빈 4KB]  = 32KB
MyRocks : [5KB][3KB][7KB][4KB]                              = 19KB
```

칸 낭비 말고도 InnoDB가 공간을 더 쓰는 이유가 두 가지 더 있다.

- **행마다 붙는 정보**: PK 항목마다 트랜잭션 ID와 롤백 포인터 13바이트를 압축하지 않고 붙인다.
- **페이지 분할로 생기는 빈 공간**: B 트리는 페이지가 꽉 차면 반으로 나눠서, 반쯤 빈 페이지가 많이 남는다. LSM은 컴팩션할 때 파일을 꽉 채워서 새로 쓴다.

### 대가 ①: 툼스톤이 남아서 범위 스캔이 느려진다

보조 인덱스는 값이 바뀔 때마다 "옛 인덱스 키 삭제 + 새 인덱스 키 추가"가 된다. LSM에서는 삭제가 툼스톤을 새로 쓰는 것이라, 좋아요 목록처럼 자주 바뀌는 인덱스에는 툼스톤이 계속 쌓인다. 범위로 읽을 때는 이 표시들까지 전부 읽고 건너뛰어야 한다.

**일반 Delete 툼스톤은 왜 바로 못 지우나**

RocksDB는 같은 키에 값을 여러 번 넣을 수 있고, 옛 값은 더 아래 파일에 남아 있을 수 있다. 툼스톤이 값 하나를 지웠다고 바로 사라지면 아래에 남은 옛 값이 다시 살아난다. 그래서 일반 Delete 툼스톤은 맨 아래 파일까지 컴팩션돼서 더 지울 게 없다는 게 확실해질 때까지 남는다.

**SingleDelete**

메타가 RocksDB에 새로 만든 삭제 방식이다. "이 키에는 값이 딱 하나만 있다"고 약속하고 쓴다. 그러면 값을 하나 만나 지우는 순간 더 찾을 게 없으니 툼스톤도 같이 버릴 수 있다.

| 단계 | 일반 Delete | SingleDelete |
|---|---|---|
| 1. 키를 지움 | 최근 파일에 툼스톤 추가 | 최근 파일에 툼스톤 추가 |
| 2. 컴팩션으로 값을 만남 | 값은 지우고 툼스톤은 남김 | 값과 툼스톤 둘 다 버림 |
| 3. 맨 아래까지 컴팩션 | 이때 툼스톤이 사라짐 | 이미 없음 |

약속을 어기면 데이터가 꼬인다.

```
1. like:7 = A 넣기
2. like:7 = B 넣기
3. like:7 SingleDelete
4. 컴팩션 → 툼스톤이 B만 지우고 사라짐 → like:7 = A가 다시 보임
```

그래서 메타는 보조 인덱스처럼 "한 번 넣고 한 번 지우는" 것이 보장되는 곳에만 SingleDelete를 썼다. 함께 툼스톤이 많은 파일을 먼저 컴팩션하도록 바꿨다.

### 대가 ②: 키 하나 찾으려고 파일 여러 개를 열어야 한다

B 트리는 키가 딱 한 곳에만 있다. LSM은 멤테이블과 여러 파일에 흩어져 있을 수 있어서 위에서부터 차례로 확인한다. UDB는 친구 목록, 좋아요 목록처럼 `WHERE user_id = ?` 형태의 범위 스캔이 많았다.

- 메타는 키 앞부분(prefix)만으로 판정하는 **prefix 블룸 필터**를 만들어서, 해당 키가 없는 파일은 건너뛰게 했다.
- 대신 블룸 필터를 메모리에 올려둬야 해서 RAM을 더 쓴다.
- 그래도 범위 스캔은 InnoDB보다 느렸고, 특히 **역순(`ORDER BY ... DESC`) 스캔**이 정순보다 느렸다. LSM은 데이터를 앞에서부터 읽기 좋게 압축해서 저장하기 때문이다.

### 대가 ③: 쓸 수 없는 InnoDB 기능

| 기능 | MyRocks | 대안 |
|---|---|---|
| 외래 키 | 없음 | 애플리케이션에서 무결성 확인 |
| 갭 락 | 없음 | 갭 락이 필요한 쿼리는 에러가 나니 고유 키로 조회하게 수정 |
| statement 기반 복제 | 사실상 불가 | row 기반 binlog 사용 |
| Online DDL | InnoDB 수준 아님 | gh-ost, pt-online-schema-change (2장 노트 참고) |
| 전문 검색 / 공간 인덱스 | 없음 | Elasticsearch 등 별도 시스템 |
| 역순 스캔 | 느림 | 인덱스를 역순으로 정의하는 옵션 고려 |

### 사례 ①: 메타 UDB (2017년 이전 완료)

UDB는 좋아요, 댓글, 공유를 담는 메인 DB이고, 규모가 수십 PB다. 전부 플래시에 올라가 있었는데 CPU와 I/O는 남고 공간이 먼저 부족해졌다.

**결과 (VLDB 2020 논문)**

| 항목 | 결과 |
|---|---|
| 인스턴스 크기 | 압축한 InnoDB 대비 62.3% 감소 |
| 디스크 쓰기량 | 75% 감소 |
| CPU | 약간 감소 |
| 서버 수 | 절반 이하 |

**이전 방법**: 핵심은 언제든 InnoDB로 되돌릴 수 있게 한 단계씩 옮긴 것이다. 두 엔진이 서로 복제가 돼서 가능했다.

1. InnoDB 복제본에서 덤프를 떠서 읽기 전용 MyRocks 복제본을 하나 만든다.
2. MyRocks 복제본을 늘리고 InnoDB 복제본을 줄인다. 서버를 추가로 사지 않았다.
3. MyRocks를 primary로 승격한다. 쓰기와 행 잠금이 몰려서 가장 어려운 단계였다. 갭 락에 기대던 쿼리를 미리 찾아 고쳐야 했다.
4. 모든 리전을 MyRocks로 바꾼다.

**검증**

- 같은 GTID 시점에 InnoDB와 MyRocks의 행 수와 체크섬 비교
- 운영 SELECT를 캡처해서 두 엔진에 똑같이 날리고 결과 비교
- MyRocks 안에서 PK와 보조 인덱스 내용이 같은지 확인

**운영하면서 겪은 문제**

- 컴팩션 후 100GB짜리 파일을 한 번에 지우면 SSD가 수 초~수십 초 멈췄다. 파일을 약 64MB씩 나눠서 천천히 지우게 바꿨다.
- 쓰기가 몰리면 컴팩션이 밀려서 응답이 멈췄다. 위쪽 레벨은 빠른 압축, 맨 아래 레벨은 강한 압축을 쓰도록 나눠서 해결했다.
- 이전 속도를 높이려고 멤테이블과 컴팩션을 건너뛰고 바로 파일로 만드는 벌크 로드를 만들었다.

**덤: 메신저**

메신저는 쓰기가 많아서 원래 HBase(LSM 기반 NoSQL)를 썼다. 플래시 환경에서 HBase가 GC 때문에 CPU를 다 써버려서, UDB 성공 이후 MySQL + MyRocks로 옮겼다. 논문은 SQL 파싱 비용보다 저장 구조, 데이터 모델링, 튜닝 가능성이 더 중요했다고 정리한다.

### 사례 ②: 우버 Schemaless / Docstore (2022년 블로그)

노드 하나에 몇 TB씩 쌓여서 재동기화와 백업이 힘들어졌다. 디스크 때문에 서버를 늘리다 보니 CPU와 메모리는 놀고 있었다. 데이터를 애플리케이션에서 이미 압축해서 넣고 있어서 InnoDB 압축은 약 5%밖에 효과가 없었다.

**결과**

- Schemaless는 디스크 30% 이상 절감. 압축률이 아니라 빈 칸과 분할 낭비가 사라진 덕분이다.
- 미리 압축하지 않던 Docstore는 훨씬 더 많이 절감됐다.
- 대신 일부 인스턴스에서 CPU와 디스크 I/O 사용률이 올라갔다.

**겪은 문제**

- 백업 도구(XtraBackup)가 MySQL 8.0부터 MyRocks를 지원해서, 5.7에서 8.0으로 먼저 올려야 했다. 이것만 1년 넘게 걸렸다.
- 운영 쿼리를 재생해보니 같은 쿼리인데 InnoDB와 MyRocks 결과가 달랐다. Percona 쪽 버그였다.
- 변환 도중 메모리 부족으로 프로세스가 죽었고, 재시작해보니 일부 테이블이 사라져 있었다.
- 변환 후 실행 계획이 바뀔 수 있어서 모든 테이블에 `ANALYZE TABLE`을 돌렸다.
- MyRocks 커뮤니티가 작아서 Percona 패치를 기다리거나 직접 우회해야 했다.
- 결론으로 "모든 사용 사례가 MyRocks에 맞지는 않는다"고 적었다. 어떤 경우가 안 맞았는지는 밝히지 않았다.

### 비교

| | 메타 UDB | 우버 Schemaless |
|---|---|---|
| 이유 | SSD 공간 부족, 쓰기 증폭 | 노드당 데이터 과다, 압축 효과 없음 |
| 공간 절감 | 62.3% | 30% 이상 |
| CPU | 약간 감소 | 일부 증가 |
| 가장 힘든 점 | 범위 스캔, 툼스톤, 컴팩션 스톨 | MySQL 8.0 업그레이드, 결과 불일치, 작은 커뮤니티 |
| 공통점 | 되돌릴 수 있게 단계적으로 이전, 실제 쿼리를 재생해서 결과 비교 | |

### 3장 내용과 연결

| 3장에서 배운 것 | 실제로 나타난 모습 |
|---|---|
| LSM은 쓰기 증폭이 낮다 | 메타 디스크 쓰기량 75% 감소 |
| LSM은 압축이 잘 되고 조각화가 적다 | 메타 62.3%, 우버 30% 이상 공간 절감 |
| LSM은 읽을 때 여러 파일을 확인한다 | 범위 스캔이 느려서 prefix 블룸 필터를 만듦 |
| 삭제는 툼스톤으로, 정리는 컴팩션으로 | 툼스톤 누적으로 스캔 성능 저하, SingleDelete 개발 |
| 컴팩션이 응답시간을 튀게 할 수 있다 | 컴팩션 스톨, 파일 삭제 스톨 |
| B 트리는 트랜잭션 잠금을 걸기 쉽다 | MyRocks는 갭 락이 없어서 쿼리를 고쳐야 했음 |

두 회사 모두 저장 공간이 병목인 상황이었고, 그래서 LSM의 장점이 대가보다 컸다. 다만 메타는 CPU가 오히려 줄었으니, LSM이 항상 더 비싸다고 볼 수는 없다. 일반적인 서비스라면 InnoDB가 여전히 기본 선택이다.

## 남은 질문

- 우버가 말한 "적합하지 않은 사용 사례"는 구체적으로 뭘까? 범위 스캔이 많은 테이블일까?
- SingleDelete의 "값은 하나뿐" 약속은 MyRocks 안에서 어떻게 보장할까?
- 국내에서 MyRocks를 운영하는 회사가 있을까?

## 참고 자료

- DDIA 3장 "SS테이블과 LSM 트리", "B 트리", "B 트리와 LSM 트리 비교"
- [MyRocks: LSM-Tree Database Storage Engine Serving Facebook's Social Graph (VLDB 2020)](https://www.vldb.org/pvldb/vol13/p3217-matsunobu.pdf)
- [Meta Engineering: Migrating a database from InnoDB to MyRocks (2017)](https://engineering.fb.com/2017/09/25/core-data/migrating-a-database-from-innodb-to-myrocks/)
- [Meta Engineering: MyRocks: A space- and write-optimized MySQL database (2016)](https://engineering.fb.com/2016/08/31/core-infra/myrocks/)
- [Uber Blog: MySQL to MyRocks Migration in Uber's Distributed Datastores (2022)](https://www.uber.com/en-GT/blog/mysql-to-myrocks-migration-in-uber-distributed-datastores/)
- [MyRocks limitations (facebook/mysql-5.6 wiki)](https://github.com/facebook/mysql-5.6/wiki/MyRocks-limitations)
- [Percona: Gap locks detection](https://docs.percona.com/percona-server/5.7/myrocks/gap_locks_detection.html)
