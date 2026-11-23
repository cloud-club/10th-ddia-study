---
type: note
author: dldusgh318
created: 2026-11-23
status: draft
tags: [replication, semi-sync, failover, split-brain, rds, aurora, idempotency]
---

# 동기·비동기 복제와 Failover: 커밋 성공은 사라질 수 있을까

- 직접 눌러보며 정리한 인터랙션 페이지: <https://claude.ai/artifact/1utJDMy9QPscMmc7mEK8Da>

## 이번에 답하려는 질문

- 클라이언트가 COMMIT 성공을 받았는데도 Failover 뒤에 그 데이터가 사라질 수 있을까?
- 반대로 에러를 받은 커밋이 실제로는 성공했을 수도 있을까?
- 우리가 쓰는 AWS RDS와 Spring 앱에서는 이 문제가 어떻게 나타날까?

## 한 줄 요약

비동기 복제에서 커밋 성공은 리더 한 대에 저장됐다는 뜻이라, 복제 전에 리더가 죽으면 사라질 수 있다. 반대로 응답 직전에 끊긴 커밋은 성공했을 수도 있어서, 쓰기 재시도는 멱등 키로 다뤄야 한다.

## 핵심 내용

### 1. 동기·비동기·반동기

세 방식의 차이는 클라이언트에게 성공을 언제 돌려주느냐 하나다.

| | 동기 | 비동기 | 반동기 |
|---|---|---|---|
| 성공 응답 시점 | 모든 팔로워가 받은 뒤 | 리더 디스크에 쓴 직후 | 팔로워 1대 이상이 받은 뒤 |
| 리더가 죽으면 | 유실 없음 | 커밋된 쓰기 유실 가능 | 확인한 팔로워를 올리면 유실 없음 |
| 팔로워가 멈추면 | 모든 쓰기가 멈춘다 | 영향 없음 | 다른 팔로워가 대신 확인한다 |

반동기에서 주의할 점이 하나 있다. 팔로워 1만 받고 팔로워 2는 못 받은 순간 리더가 죽으면, 팔로워 2를 새 리더로 올릴 경우 성공한 쓰기가 사라진다. 성공 전에 누구를 기다리는지와 장애 후 누구를 올리는지는 별개의 문제다.

### 2. MySQL 반동기에서 알아야 할 것

이 노트에서는 쓰기를 받는 서버를 리더, 리더를 따라가는 서버를 팔로워로 통일한다. MySQL은 source/replica, PostgreSQL은 primary/standby, AWS는 writer/reader라고 부르지만 역할은 같다.

MySQL 커밋은 두 단계다. 먼저 변경 내용을 binlog(팔로워에게 보내는 변경 기록 파일)에 쓰고, 그다음 InnoDB가 실제로 커밋한다(엔진 커밋). 엔진 커밋이 끝나야 다른 세션이 조회했을 때 그 데이터가 보인다.

팔로워의 확인(ACK)은 받은 변경을 릴레이 로그에 쓰고 디스크에 flush했다는 뜻이다. 테이블 적용은 그 뒤에 따로 일어나므로, 확인을 보낸 팔로워에서 바로 읽어도 예전 값이 나올 수 있다. 반동기가 보장하는 건 "잃지 않는다"이지 "바로 읽힌다"가 아니다.

MySQL 커밋은 binlog 기록과 엔진 커밋의 두 단계라서, 그 사이 어디서 팔로워를 기다릴지 정해야 한다.

| | AFTER_COMMIT | AFTER_SYNC |
|---|---|---|
| 순서 | 엔진 커밋 후 팔로워를 기다림 | 팔로워를 기다린 뒤 엔진 커밋 |
| 문제 | 커밋한 클라이언트보다 다른 클라이언트가 먼저 데이터를 볼 수 있다. 이때 리더가 죽으면 남이 본 데이터가 사라진다 | 모든 클라이언트가 팔로워 확인 뒤에 동시에 본다 |
| 기본값 | 5.7.2 이전 동작 | 5.7.2부터 기본값 |

메타는 5.6 시절에 5.7의 AFTER_SYNC(lossless semisync) 패치를 가져와 썼다. Matsunobu는 클라이언트가 많을 때 처리량도 AFTER_SYNC 쪽이 더 좋았다고 썼다. 다만 대다수 서비스가 AFTER_SYNC를 쓴다는 통계는 없다. 대부분은 반동기 자체를 쓰지 않고 비동기를 쓴다.

어느 쪽을 골라도 팔로워가 정해진 시간(기본 10초) 안에 확인을 보내지 않으면 리더는 비동기로 바뀌고 쓰기를 계속 받는다. 팔로워가 따라잡으면 다시 반동기로 돌아온다. 그래서 `Rpl_semi_sync_source_status`(8.0.26 이전 이름은 `..._master_status`)가 0이 되면 알림이 오게 해야 한다.

#### PostgreSQL에는 이 문제가 없을까

AFTER_COMMIT의 문제는 다른 세션에 보이게 하는 시점이 팔로워 확인을 기다리는 시점보다 앞선다는 데 있었다. PostgreSQL은 이 순서를 고르는 설정이 없다. 소스(`xact.c`의 `CommitTransaction`)를 보면 동기 복제를 켰을 때 커밋은 항상 이 순서다.

| 순서 | 리더에서 일어나는 일 | 다른 세션이 조회하면 |
|---|---|---|
| 1 | 커밋 기록(WAL)을 디스크에 쓰고 커밋됨으로 표시한다 | 아직 진행 중으로 보인다 |
| 2 | 팔로워의 확인을 기다린다. 락도 계속 잡고 있다 | 아직 진행 중으로 보인다 |
| 3 | 확인이 오면 진행 중인 트랜잭션 목록에서 빠진다 | 이제 보인다 |

확인을 기다린 다음 보이게 하니까 AFTER_SYNC와 같은 순서다. 다만 1번에서 이미 로컬 커밋이 끝나서, 기다리다 멈춰도 되돌릴 수 없다. 소스 주석은 "에러를 내면 실패로 오해하고, 성공을 돌려주면 복제됐다고 오해한다"고 설명하고, 그래서 경고만 낸다.

| 기다림이 끝나는 경우 | PostgreSQL이 하는 일 | 결과 |
|---|---|---|
| 쿼리 취소, 관리자의 세션 종료 | "The transaction has already committed locally, but might not have been replicated to the standby." 경고 후 기다림을 끝낸다 | 확인 못 받은 트랜잭션이 다른 세션에 보인다 |
| postmaster(메인 프로세스) 종료 | 경고 없이 기다림을 끝낸다 | 위와 같다 |
| 리더 재시작 | 기다리던 트랜잭션을 커밋된 것으로 처리한다 | 리더에서는 커밋인데 팔로워에는 없을 수 있다 |

| | MySQL 반동기 | PostgreSQL 동기 복제 |
|---|---|---|
| 보이는 시점과 기다리는 시점의 순서 | 설정으로 고른다 | 고를 수 없다. 항상 기다린 다음 보인다 |
| 남이 본 데이터가 사라질 수 있나 | AFTER_COMMIT이면 평소에도 있다 | 평소엔 없다. 기다림이 끊기거나 리더가 재시작되면 생긴다 |
| 팔로워가 끝내 응답하지 않으면 | 타임아웃 뒤 자동으로 비동기 | 자동 전환이 없다. 커밋이 기다리고 관리자가 설정을 바꿔야 한다 |

PostgreSQL 기본값은 비동기다(`synchronous_standby_names`가 비어 있음). 몇 대를 기다릴지는 `synchronous_standby_names`(예: `ANY 1 (s1, s2)`, 10부터), 어디까지 기다릴지는 `synchronous_commit`(`off`, `local`, `remote_write`, `on`, `remote_apply`)로 따로 정하고, 후자는 트랜잭션마다 바꿀 수 있다.

### 3. Failover

장애 판단, 새 리더 선택, 재설정의 세 단계다. 타임아웃이 길면 복구가 늦고, 짧으면 잠깐 느린 리더를 죽었다고 오판한다. 예전 리더에만 있던 쓰기는 보통 버린다. 책의 깃허브 사례에서는 뒤처진 팔로워가 리더가 되면서 자동 증가 PK를 다시 발급했고, 그 PK를 함께 쓰던 Redis와 어긋나 다른 사용자의 데이터가 보였다.

#### 비동기에서 유실을 줄이는 방법

리더가 죽어도 그 쓰기는 리더 디스크에 남아 있다. 사라지는 건 그 쓰기가 없는 팔로워를 새 리더로 올리고 예전 리더의 쓰기를 버릴 때다. 그래서 유실을 0으로 만들 수는 없지만 잃는 양은 줄일 수 있다.

| 방법 | 내용 | 대가 |
|---|---|---|
| 리더 재시작을 기다린다 | 프로세스만 죽고 디스크가 멀쩡하면 Failover하지 않는다 | 그동안 쓰기가 멈춘다 |
| 팔로워끼리 빠진 로그를 맞춘다 | 가장 최신 팔로워를 새 리더로 올리고 그 팔로워에만 있는 로그를 다른 팔로워에 적용한다 | 최신 팔로워에도 없는 쓰기는 잃는다 |
| 복제 지연을 감시한다 | 지연이 곧 잃을 수 있는 양이다 | 운영 부담 |
| 반동기나 동기 복제로 바꾼다 | AFTER_SYNC, RDS Multi-AZ | 쓰기가 느려진다 |

실제 사례:

- MHA: 최신 팔로워 중에서 새 리더를 고르고, 그 팔로워의 릴레이 로그에만 있는 변경을 다른 팔로워에 적용한다. <https://github.com/yoshinorim/mha4mysql-manager/wiki/Overview>
- 메타(2014): AFTER_SYNC 반동기와 binlog만 받는 가벼운 서버(binlog 서버)를 쓴다. Failover 때 가장 최신 binlog 서버의 로그를 새 리더에 적용한다. 리더와 그 서버가 함께 죽으면 잃을 수 있어서 타임아웃을 길게, binlog 서버는 2대 이상 두라고 권한다. <https://yoshinorimatsunobu.blogspot.com/2014/04/semi-synchronous-replication-at-facebook.html>
- GitHub(2018): Orchestrator로 Failover한다. 같은 데이터센터 안의 리더 장애에서는 유실 없는 Failover가 목표이고, 데이터센터 전체 장애까지는 기대하지 않는다. <https://github.blog/engineering/infrastructure/mysql-high-availability-at-github/>
- Orchestrator 문서: 가장 최신 팔로워를 무조건 올리는 게 항상 맞지는 않다고 쓴다. 버전, binlog 형식, 복제 필터를 따져서 다른 팔로워를 계속 거느릴 수 있는 후보를 고른다. <https://github.com/openark/orchestrator/blob/master/docs/topology-recovery.md>

### 4. AWS는 복제를 어떻게 구현했나

| | Multi-AZ 인스턴스 | Multi-AZ DB 클러스터 | Read Replica | Aurora |
|---|---|---|---|---|
| 복제 | 동기 | 반동기(팔로워 1대 이상 확인) | 비동기 | 3개 AZ의 스토리지 노드 6개에 복제 |
| 팔로워에서 읽기 | 안 됨 | 됨 | 됨 | 됨 |
| Failover | 자동 | 자동 | 운영자가 직접 승격 | 자동 |
| DB 쪽 Failover 시간 | 보통 60~120초 | 보통 35초 미만 | 사람이 승격하는 시간 | 보통 60초 미만, 대개 30초 미만 |

- Multi-AZ 인스턴스는 Failover 때 DB 인스턴스의 DNS 레코드가 팔로워를 가리키게 자동으로 바뀐다. 그래서 기존 연결은 다시 맺어야 한다.
- Read Replica는 비동기라서 원본이 죽었을 때 최신이 아닐 수 있다. 승격은 운영자가 직접 하고, AWS 문서는 승격 전에 쓰기를 멈추고 복제 지연을 확인하라고 한다.
- Aurora는 AWS의 MySQL·PostgreSQL 호환 DB다. DB 서버와 스토리지가 분리돼 있고 리더와 팔로워가 같은 스토리지를 함께 쓴다. AZ 하나가 죽어도 데이터를 잃지 않고 잠깐의 중단만 생기며, 팔로워 승격은 리더 서버를 복구하는 것보다 훨씬 빠르다.
- Multi-AZ DB 클러스터에서 팔로워가 아무도 확인하지 않을 때 쓰기를 멈추는지, 비동기로 바꾸는지는 AWS 문서에 나오지 않는다.
- 위 시간은 DB가 넘어가는 시간이다. 앱이 새 리더를 찾아 붙는 시간은 따로다.

### 5. DB가 넘어가는 동안 Spring 앱에서는

앱은 DB를 엔드포인트 이름으로 찾고, 커넥션 풀의 연결을 재사용한다. 그래서 DB가 넘어가도 바로 따라가지 못한다.

| 지점 | 기본 동작 | 문제 | 대응 |
|---|---|---|---|
| JVM DNS 캐시 | 조회한 IP를 기억한다 | 예전 리더 IP로 계속 붙는다 | `networkaddress.cache.ttl`을 짧게 둔다(AWS 문서 예시는 5초) |
| HikariCP | `maxLifetime` 기본 30분 | 풀의 연결이 예전 리더를 가리킨다 | 에러 난 연결은 버리고 새로 맺는다 |
| Connector/J | `socketTimeout`, `connectTimeout` 기본 0(무제한) | 죽은 서버 응답을 끝없이 기다리다 풀이 바닥난다 | 두 타임아웃을 명시한다 |

#### 커밋 중에 연결이 끊기면

COMMIT은 앱이 요청을 보내고 DB가 응답을 돌려주는 왕복이다. 리더가 언제 죽었느냐에 따라 DB 상태는 다르지만, 앱이 받는 건 모두 같은 연결 에러다.

| 리더가 죽은 시점 | DB 상태 | 앱이 받는 것 |
|---|---|---|
| COMMIT 요청이 도착하기 전 | 커밋 안 됨 | 연결 에러 |
| 커밋 처리 중 | 커밋 안 됨 | 연결 에러 |
| 커밋은 끝났고 응답을 보내기 전 | 커밋됨 | 연결 에러 |

앱은 셋 중 어느 경우인지 알 수 없다. 세 번째 경우에 새 리더에 주문이 남아 있는지는 복제 방식에 달렸다. 동기나 반동기(AFTER_SYNC)면 남아 있고, 비동기면 없을 수도 있다. 앞에서는 성공을 받았는데 데이터가 없을 수 있었고, 여기서는 에러를 받았는데 데이터가 있을 수 있다.

그냥 재시도하면 주문이 두 개 생길 수 있다. 멱등 키를 쓰면 몇 번을 재시도해도 한 번만 반영된다.

```sql
CREATE TABLE orders (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  request_id  CHAR(36) NOT NULL UNIQUE,  -- 클라이언트가 만든 UUID, 재시도 때도 같은 값
  ...
);
```

첫 요청이 커밋되지 않았다면 재시도한 INSERT가 그대로 성공한다. 이미 커밋됐다면 유니크 제약 위반이 나고, 서버는 기존 주문을 찾아 성공으로 응답한다. 어느 쪽이든 주문은 하나만 남는다.

AWS Advanced JDBC Wrapper는 이 상황을 예외 종류로 나눠 알려준다.

| 예외 | SQLState | 무슨 일이 있었나 | 앱이 할 일 |
|---|---|---|---|
| `FailoverSuccessSQLException` | `08S02` | 트랜잭션 밖에서 끊겼고 새 리더에 다시 연결했다. 세션 설정은 사라졌다 | 세션 설정을 다시 하고 쿼리를 다시 실행한다 |
| `TransactionStateUnknownSQLException` | `08007` | 트랜잭션 중에 끊겼다. 드라이버가 롤백을 시도하지만 됐는지 확실하지 않다 | 트랜잭션을 처음부터 다시 실행한다. 멱등 키가 있어야 안전하다 |
| `FailoverFailedSQLException` | `08001` | 새 리더에 연결하지 못했다 | 에러를 돌려주고 나중에 재시도한다 |

### 6. 스플릿 브레인

리더는 살아 있는데 네트워크만 끊기면 나머지 노드는 새 리더를 뽑고, 예전 리더는 자기가 밀려난 줄 모른다. 두 리더가 각자 쓰기를 받으면 데이터가 갈라진다. 펜싱은 새 리더를 올리기 전에 예전 리더를 `read_only`로 바꾸거나 꺼서, 잠깐 쓰기 에러를 내는 대신 데이터가 갈라지지 않게 한다.

GitHub 2018년 10월 장애가 실제 사례다. 동부 네트워크 허브와 데이터센터 사이 연결이 끊겼다가 43초 만에 복구됐다. 그사이 Orchestrator가 서부로 Failover했고, 동부에는 서부로 복제되지 않은 쓰기가 남았다. 이를 맞추느라 서비스가 24시간 11분 동안 저하됐다.

## 남은 질문

- Multi-AZ DB 클러스터는 팔로워 확인이 끝내 오지 않으면 어떻게 동작할까?
- 우리 프로젝트의 RDS는 어떤 구성이고, Failover가 나면 앱은 몇 초 만에 따라갈까?

## 참고 자료

- Martin Kleppmann, 『데이터 중심 애플리케이션 설계』 5장
- MySQL 8.0 Reference Manual, Semisynchronous Replication: <https://dev.mysql.com/doc/refman/8.0/en/replication-semisync.html>
- MySQL 5.7.2 Release Notes: <https://dev.mysql.com/doc/relnotes/mysql/5.7/en/news-5-7-2.html>
- Yoshinori Matsunobu, Semi-Synchronous Replication at Facebook (2014): <https://yoshinorimatsunobu.blogspot.com/2014/04/semi-synchronous-replication-at-facebook.html>
- AWS, Multi-AZ DB cluster deployments: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html>
- AWS, Failing over a Multi-AZ DB instance: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html>
- AWS, Aurora high availability: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html>
- AWS, Setting the JVM TTL for DNS name lookups: <https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/jvm-ttl-dns.html>
- AWS Advanced JDBC Wrapper, Failover Plugin: <https://github.com/aws/aws-advanced-jdbc-wrapper/blob/main/docs/using-the-jdbc-driver/using-plugins/UsingTheFailoverPlugin.md>
- GitHub, October 21 post-incident analysis: <https://github.blog/news-insights/company-news/oct21-post-incident-analysis/>
