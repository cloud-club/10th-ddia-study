# 핸드오프: DDIA 실습 랩 1차 — 가비아 클라우드에 k8s 3노드 클러스터 구성과 Pod·Deployment 체험

가비아 클라우드에 VM 3대를 만들어 쿠버네티스 클러스터 하나로 묶고, Pod와 Deployment를 직접 띄우고 깨 보는 작업입니다. 쿠버네티스가 무엇을 해 주는지 몸으로 익히는 게 목적입니다.
쿠버네티스를 처음 다뤄도 위에서부터 순서대로 따라가면 끝까지 갈 수 있게 썼습니다.

- 전체 설계: [실습 환경 다이어그램](../notes/실습-환경-다이어그램.html) — 이 문서는 그중 ⑤ 구축 순서의 **1차**만 다룹니다.
- 작업 시간: 처음이면 하루 정도 잡으세요. 클러스터 구성(1~6단계)에 절반, 체험(7단계)에 절반입니다.
- **가비아 콘솔에서 자원 만들기(0단계)는 sese2204가 미리 해 둡니다.** 받는 사람은 0단계의 「받는 사람이 할 일」만 하고 1단계부터 시작합니다.
- 운영 기간: 자원은 **집중 실습 기간 2주 동안만** 켜 두고, 끝나면 전부 삭제합니다. 예상 비용은 부가세 포함 **약 10.8만 원**으로, 지원받는 크레딧 100달러 안에 들어옵니다(「비용」 참고).

## 범위

| 포함 | 제외 (이번에 하지 않음) |
|---|---|
| 0단계에서 만들어 둔 자원 확인 | 가비아 콘솔에서 자원 만들기 (sese2204가 해 둠) |
| | Postgres 직접 설치(systemd 층), CNPG |
| VM 3대 공통 준비 (containerd, 커널 설정) | 실습용 etcd(12379), Elasticsearch(ECK) |
| kubeadm으로 control-plane 3대 클러스터 구성 | 장애 주입 스크립트(`chaos/`), 실험 README |
| Cilium(네트워크 플러그인) 설치와 노드 간 통신 확인 | 앱을 인터넷에 공개하는 인그레스 (「인그레스 검토」 참고) |
| 로컬 노트북에서 `kubectl` 접속 | Job · CronJob (여유 있으면 추가) |
| Pod · Deployment · Service 체험, 노드 장애 체험 | |

## 다 끝났다는 기준

- [ ] `kubectl get nodes`에서 node1~3이 모두 `Ready`
- [ ] etcd 멤버가 3개이고 모두 `started`
- [ ] 서로 다른 노드에 있는 Pod끼리 통신되고, Service 이름으로 접속됨
- [ ] 로컬 노트북에서 `kubectl`로 클러스터를 조작할 수 있음
- [ ] **노드 하나(node1 포함)를 중지해도 `kubectl`이 계속 동작함**
- [ ] 7단계 체험 6개를 해 보고, 관찰한 것을 한 줄씩 남김
- [ ] 사용한 버전을 `versions.env`에 기록함

## 정해 둔 값

이 문서의 명령은 아래 값을 기준으로 씁니다. 바꾸면 문서 전체에서 같이 바꾸세요.

| 항목 | 값 | 비고 |
|---|---|---|
| 클라우드 | 가비아 클라우드 Gen2 | 신규 가입은 Gen2만 가능 |
| OS | Ubuntu 24.04 LTS | 가비아 이미지, 무료 |
| 서버 사양 | High CPU 2vCore · 4GB, 루트 SSD 50GB | kubeadm 최소 조건은 CPU 2개 · 메모리 2GB |
| 로그인 | `root` + SSH 키 페어 | 가비아 리눅스 서버의 관리자 계정은 `root` |
| VPC | `10.10.0.0/16` | |
| 서브넷 | `10.10.0.0/24` (퍼블릭) | 첫 3개와 마지막 IP는 가비아가 예약 |
| 노드 사설 IP | node1 `10.10.0.11` · node2 `10.10.0.12` · node3 `10.10.0.13` | 서버를 한 대씩 만들어야 IP를 지정할 수 있음 |
| 로드밸런서 사설 IP (VIP) | `10.10.0.10` | API 서버 앞에 둠 |
| API 주소 | `k8s-api.lab:6443` → 로드밸런서 | 이름이라서 나중에 바꾸기 쉬움 |
| Pod IP 대역 | `10.244.0.0/16` | VPC 대역과 겹치면 안 됨 |
| 버전 | 쿠버네티스 · Cilium 최신 안정판 | `versions.env`에 고정 |

가비아 계정과 결제, 프로젝트는 sese2204가 관리합니다. 실제로 만든 IP가 위 표와 다르면 sese2204가 알려 줍니다.

## 큰 그림

```text
 로컬 노트북 ── kubectl ──(SSH 터널, 아무 노드나)──┐
      │                                              ▼
      └── ssh(22) ──▶ 각 노드 공인 IP        가비아 로드밸런서 10.10.0.10:6443  (내부용, 공인 IP 없음)
                                                     │ TCP, 살아 있는 노드로만 전달
                       ┌─────────────────────────────┼─────────────────────────────┐
                       ▼                             ▼                             ▼
 ┌──────── node1 10.10.0.11 ┐ ┌──────── node2 10.10.0.12 ┐ ┌──────── node3 10.10.0.13 ┐
 │ control-plane            │ │ control-plane            │ │ control-plane            │
 │  apiserver · etcd        │ │  apiserver · etcd        │ │  apiserver · etcd        │
 │  scheduler · controller  │ │  scheduler · controller  │ │  scheduler · controller  │
 │ kubelet · containerd     │ │ kubelet · containerd     │ │ kubelet · containerd     │
 │ Cilium                   │ │ Cilium                   │ │ Cilium                   │
 │ [내 Pod들]               │ │ [내 Pod들]               │ │ [내 Pod들]               │
 └──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
          ◀──────── etcd 3대가 Raft로 같은 상태를 유지 (9장 합의) ────────▶
```

- 세 대 모두 관리 역할(control-plane)을 맡으면서 내 Pod도 돌립니다. 한 대가 죽어도 나머지 두 대가 과반이라 클러스터 상태(etcd)가 유지됩니다.
- 모든 노드와 노트북은 API 서버를 **로드밸런서 주소로** 찾습니다. 어느 노드가 죽어도 로드밸런서가 살아 있는 노드로 보내 주므로 `kubectl`이 끊기지 않습니다.

**설계 문서의 kube-vip를 로드밸런서로 바꾼 이유**: 가비아 클라우드는 OpenStack 기반입니다(가비아의 쿠버네티스 로드밸런서 매뉴얼이 `loadbalancer.openstack.org` 설정을 씀). OpenStack 네트워크는 보통 서버에 등록되지 않은 IP의 패킷을 버려서, kube-vip처럼 노드끼리 가상 IP를 넘겨 주는 방식이 동작하지 않을 가능성이 높습니다(추정, 미검증). 가비아 로드밸런서는 월 15,000원이고 같은 역할을 확실하게 합니다.

### 꼭 알아야 할 용어 8개

| 용어 | 한 줄 설명 |
|---|---|
| 노드(Node) | 쿠버네티스가 일을 시키는 서버 한 대. 여기서는 VM 한 대 |
| control-plane | 클러스터의 두뇌. API 서버 · etcd · 스케줄러 · 컨트롤러로 구성 |
| etcd | 클러스터의 모든 상태를 저장하는 분산 키-값 저장소 |
| kubelet | 각 노드에서 "이 Pod를 띄워라"는 지시를 실제로 수행하는 에이전트 |
| Pod | 컨테이너를 띄우는 최소 단위. 혼자 띄운 Pod는 죽으면 그걸로 끝 |
| Deployment | "이 Pod를 N개 유지해라"는 선언. 죽으면 다시 만들고, 버전 교체도 맡음 |
| Service | 바뀌는 Pod들 앞에 고정된 이름과 주소를 붙여 주는 것 |
| CNI (Cilium) | 노드가 달라도 Pod끼리 통신하게 해 주는 네트워크 플러그인 |

## 비용

**2주(336시간) 켜 두면 부가세 포함 약 10.8만 원**입니다. 크레딧 100달러(1달러 1,400원 가정 시 14만 원) 안에 들어옵니다.
가비아 클라우드 공식 요금표 기준입니다(2026-11-02 확인). 가비아는 시간 요금으로 매기다가 월 요금을 넘으면 월 요금에서 멈추는데, 2주는 월 요금에 닿지 않아 시간 요금으로 계산했습니다.

| 항목 | 시간 요금 | 수량 | 2주 합계 (부가세 별도) |
|---|---|---|---|
| 서버 High CPU 2vCore · 4GB | 77원 | 3 | 77,616원 |
| 루트 스토리지 SSD 50GB (10GB당 1.6원) | 8원 | 3 | 8,064원 |
| 공인 IP | 5.6원 | 3 | 5,645원 |
| 로드밸런서 (내부용, 공인 IP 없음) | 21원 | 1 | 7,056원 |
| Ubuntu, VPC, 서브넷, 보안 그룹, 노드 간 사설 트래픽 | 무료 | | 0원 |
| **합계** | **292.8원** | | **98,381원 (부가세 포함 108,219원)** |

- **크레딧으로 버틸 수 있는 기간**: 전부 켜 두면 약 18일입니다. 2주를 넘기면 4일 안에 정리해야 합니다. 환율은 크레딧을 받을 때 다시 확인하세요.
- **밤에 서버를 「종료」하면 더 아낍니다.** 종료하면 서버 요금(3대 합계 시간당 231원)이 빠집니다. 하루 10시간씩 2주 동안 종료하면 약 3.2만 원(부가세 별도)이 줄어듭니다.
    - **「중지」는 요금이 그대로** 나옵니다. 아끼려면 반드시 「종료」를 씁니다.
    - 종료해도 스토리지 · 공인 IP · 로드밸런서 요금(시간당 61.8원)은 계속 나갑니다.
    - 종료·시작은 콘솔 작업이라 sese2204가 합니다. 다시 켤 때는 **세 대를 모두** 시작합니다. etcd는 3대 중 2대 이상이 떠야 동작합니다. 켠 뒤 `kubectl get nodes`로 세 대가 `Ready`인지 확인하고 이어서 진행합니다.
- **실습이 끝나면 전부 삭제합니다.** 서버를 종료만 해 두면 스토리지 · 공인 IP · 로드밸런서 요금으로 한 달에 약 4.5만 원이 계속 나갑니다. 「실습이 끝나면: 자원 삭제」 체크리스트를 따릅니다.
- 서버 사양은 서버를 중지한 상태에서 바꿀 수 있습니다. 2차(Postgres·ES)에서 메모리가 모자라 Standard(2vCore · 8GB, 시간당 96원)로 올리면 2주 비용이 약 2만 원(부가세 별도) 늘어납니다.

## 0단계 · 가비아 콘솔에서 자원 만들기 (sese2204가 해 둠)

**이 단계는 sese2204가 미리 해 둡니다.** 받는 사람은 콘솔에 들어가지 않아도 됩니다. 아래 0-1~0-5는 무엇이 어떻게 만들어져 있는지 알려 주는 기록이고, 막혔을 때 원인을 짚는 데 씁니다.

### 받는 사람이 할 일

1. 시작하기 전에 sese2204에게 두 가지를 보냅니다. 보안 그룹과 서버에 등록해 접속할 수 있게 해 줍니다.
    - 노트북의 SSH **공개 키** (`~/.ssh/id_ed25519.pub` 등. 개인 키는 절대 보내지 않음)
    - 노트북의 공인 IP (`curl ifconfig.me`로 확인)
2. sese2204에게서 세 노드의 공인 IP를 받습니다.
3. 접속되는지 확인합니다.

    ```bash
    ssh root@<node1 공인 IP>   # node2, node3도
    ```

4. 집·카페처럼 장소가 바뀌어 공인 IP가 달라지면 SSH가 막힙니다. 새 IP를 sese2204에게 알려 주세요.

### 만들어 두는 자원

콘솔 메뉴는 [가비아 클라우드 Gen2 매뉴얼](https://customer.gabia.com/manual/cloud/20444)과 같은 이름을 씁니다.

### 0-1. SSH 키 페어

`[컴퓨팅] > [SSH 키 페어] > SSH 키 페어 생성`

- 노트북에 이미 키가 있으면 `기존에 보유한 키 페어 등록`으로 공개 키(`~/.ssh/id_ed25519.pub` 등)를 올리는 게 편합니다.
- 새로 만들면 개인 키 파일을 **한 번만** 내려받을 수 있습니다. 잃어버리면 복구할 수 없습니다.

### 0-2. VPC와 서브넷

1. `[네트워크] > [VPC] > VPC 생성`: IP 주소 범위 `10.10.0.0/16`
2. `[네트워크] > [서브넷] > 서브넷 생성`: IP 주소 범위 `10.10.0.0/24`
3. 서브넷이 **퍼블릭**(라우터에 외부망이 연결된 상태)인지 확인합니다. 프라이빗이면 서버에 공인 IP를 붙일 수 없습니다. 연결 방법은 [라우팅 테이블 · 외부망 연결 매뉴얼](https://customer.gabia.com/manual/cloud/26281/26286)을 보세요.

### 0-3. 보안 그룹

`[네트워크] > [보안 그룹] > 보안 그룹 생성`, 이름 `k8s-lab`

| 방향 | 프로토콜 | 포트 | IP/CIDR | 이유 |
|---|---|---|---|---|
| 인바운드 | TCP | 22 | **내 공인 IP**/32 | SSH. 내 IP는 `curl ifconfig.me`로 확인 |
| 인바운드 | TCP | 1-65535 | 10.10.0.0/24 | 노드 · 로드밸런서 간 통신 |
| 인바운드 | UDP | 1-65535 | 10.10.0.0/24 | Cilium 노드 간 터널(8472) 등 |
| 인바운드 | ICMP | 전체 | 10.10.0.0/24 | Cilium 상태 확인, `ping` |
| 아웃바운드 | 전체 | 전체 | 0.0.0.0/0 | 패키지 · 컨테이너 이미지 받기 |

- API 포트(6443)는 인터넷에 열지 않습니다. 노트북은 SSH 터널로 접속합니다(6-3단계).
- 로드밸런서는 서브넷 안의 사설 IP로 노드에 접속하므로, 두 번째 규칙으로 함께 허용됩니다.
- 사설 서브넷 전체 허용이 어렵다면, 최소한 아래 포트는 열어야 합니다.

| 포트 | 용도 |
|---|---|
| TCP 6443 | API 서버 (노드끼리, 로드밸런서 → 노드) |
| TCP 2379-2380 | etcd |
| TCP 10250, 10257, 10259 | kubelet, controller-manager, scheduler |
| UDP 8472 | Cilium 노드 간 터널(VXLAN) |
| TCP 4240 | Cilium 상태 확인 |
| TCP 4244 | Hubble |
| ICMP | Cilium 상태 확인 |

### 0-4. 서버 3대

`[컴퓨팅] > [서버] > 서버 생성하기`를 **한 대씩 세 번** 합니다. 동시에 여러 대를 만들면 사설 IP를 지정할 수 없습니다.

| 설정 | 값 |
|---|---|
| 이미지 | 운영체제(OS) → Ubuntu 24.04 LTS |
| 사양 | High CPU · 2vCore · 4GB, 개수 1 |
| 루트 스토리지 | 50GB (만든 뒤에는 바꿀 수 없음) |
| 데이터 스토리지 | 사용 안 함 |
| 로그인 방식 | SSH 키 페어로 접속 → 0-1에서 만든 키 |
| 네트워크 | 서브넷 `10.10.0.0/24`, 사설 IP `10.10.0.11` (두 번째 `.12`, 세 번째 `.13`), 공인 IP `공인 IP 생성하기`, 보안 그룹 `k8s-lab` |
| 이름 | `node1`, `node2`, `node3` |

받는 사람의 SSH 공개 키는 각 서버의 `/root/.ssh/authorized_keys`에 추가해 둡니다.

### 0-5. 로드밸런서 (API 서버용)

`[네트워크] > [로드밸런서] > 로드밸런서 생성하기`

| 설정 | 값 |
|---|---|
| 서브넷 | `10.10.0.0/24` |
| 사설 IP | `10.10.0.10` (로드밸런서는 이 VIP 말고도 서버 통신용 사설 IP 2개를 더 가져감) |
| 리스너 프로토콜 · 포트 | **TCP 6443** (HTTP/HTTPS가 아님. API 서버가 TLS를 직접 처리) |
| 밸런스 모드 | Round Robin |
| 연결 서버 | node1, node2, node3 의 6443 포트 |
| 상태 모니터링 | TCP 6443 |
| 공인 IP | 연결하지 않음 (내부용) |
| 이름 | `k8s-api` |

지금은 어느 노드에도 API 서버가 없어서 상태 모니터링이 모두 실패로 보입니다. **정상**입니다. 3단계가 끝나면 node1부터 정상으로 바뀝니다.

## 1단계 · VM 공통 준비 (3대 모두)

**node1, node2, node3 각각에** `root`로 접속해 똑같이 실행합니다. `root`이므로 `sudo`는 붙이지 않습니다.

### 1-1. 호스트 이름과 이름 매핑

```bash
hostnamectl set-hostname node1   # node2, node3은 각자 이름으로

cat <<'EOF' >> /etc/hosts
10.10.0.11 node1
10.10.0.12 node2
10.10.0.13 node3
10.10.0.10 k8s-api.lab
EOF
```

`k8s-api.lab`은 로드밸런서를 가리킵니다. 클러스터 안의 모든 구성 요소가 이 이름으로 API 서버를 찾습니다.

### 1-2. OS 방화벽 확인

가비아 Ubuntu 이미지의 기본 방화벽 설정은 확인하지 못했습니다. 아래를 실행해 보고, 막는 규칙이 있으면 **sese2204에게 확인한 뒤** 처리합니다. 바깥 접근은 0-3의 보안 그룹이 막아 줍니다.

```bash
ufw status                         # "Status: inactive"면 그대로 둠
iptables -S | grep -Ei 'reject|drop'   # 아무것도 안 나오면 그대로 둠
```

`ufw`가 `active`라면 `ufw disable`로 끄는 걸 권장합니다.

### 1-3. 스왑 끄기, 커널 설정

쿠버네티스는 기본 설정에서 스왑이 켜져 있으면 설치를 거부합니다.

```bash
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab

cat <<'EOF' > /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter

cat <<'EOF' > /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system
```

확인: `sysctl net.ipv4.ip_forward` → `= 1`

### 1-4. 시간 동기화 (chrony)

etcd와 인증서는 노드 간 시계가 맞아야 정상 동작합니다.

```bash
apt-get update
apt-get install -y chrony
chronyc tracking   # "Leap status : Normal"이면 정상
```

### 1-5. 컨테이너 런타임 (containerd)

```bash
apt-get install -y containerd
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
# kubelet과 같은 cgroup 드라이버(systemd)를 쓰게 한다
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd
systemctl enable containerd
```

확인: `grep SystemdCgroup /etc/containerd/config.toml` → `SystemdCgroup = true`
이걸 빠뜨리면 나중에 kubelet과 Pod가 이유 없이 계속 재시작합니다.

### 1-6. kubeadm · kubelet · kubectl 설치

버전은 [Kubernetes 릴리스 페이지](https://kubernetes.io/releases/)에서 최신 안정판의 마이너 버전(예: `v1.xx`)을 골라 쓰고, 세 노드 모두 같은 값을 씁니다.

```bash
K8S_MINOR=v1.xx   # ← 최신 안정판 마이너 버전으로 바꾸기

apt-get install -y apt-transport-https ca-certificates curl gpg
mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL "https://pkgs.k8s.io/core:/stable:/${K8S_MINOR}/deb/Release.key" \
  | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${K8S_MINOR}/deb/ /" \
  > /etc/apt/sources.list.d/kubernetes.list

apt-get update
apt-get install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl   # 자동 업그레이드로 버전이 어긋나는 것 방지
systemctl enable kubelet
```

확인: `kubeadm version -o short` → 세 노드가 같은 버전.
이 시점에 `systemctl status kubelet`이 계속 재시작 중인 건 **정상**입니다. 아직 할 일을 받지 못해서 그렇습니다.

### 1-7. 노드 간 길 확인

```bash
apt-get install -y netcat-openbsd
nc -zv node2 22             # succeeded → 노드 간 길은 열림
nc -zv -w 3 k8s-api.lab 6443   # Connection refused → 정상 (로드밸런서까지는 닿음)
                               # 시간 초과(timed out) → 로드밸런서 또는 보안 그룹 문제
```

두 번째 명령은 [kubeadm 공식 문서](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/)가 권하는 확인법입니다. 아직 API 서버가 없으니 거부(refused)가 나와야 맞습니다.

## 2단계 · 첫 control-plane 만들기 (node1에서만)

```bash
kubeadm init \
  --control-plane-endpoint "k8s-api.lab:6443" \
  --upload-certs \
  --apiserver-advertise-address 10.10.0.11 \
  --pod-network-cidr 10.244.0.0/16
```

| 옵션 | 뜻 |
|---|---|
| `--control-plane-endpoint` | 클러스터 API의 공식 주소. 로드밸런서를 가리키는 이름 |
| `--upload-certs` | node2·3이 관리 역할로 합류할 때 쓸 인증서를 클러스터에 잠깐 올려 둠 |
| `--apiserver-advertise-address` | 이 노드의 사설 IP |
| `--pod-network-cidr` | Pod에 줄 IP 대역. **VPC 대역(10.10.0.0/16)과 겹치면 안 됨** |

진행 중에 로드밸런서 상태 모니터링이 node1을 정상으로 바꾸고, 그때부터 `k8s-api.lab`으로 API에 닿습니다. 몇 분 걸릴 수 있습니다.

성공하면 끝부분에 `kubeadm join ...` 명령이 **두 개** 나옵니다.

- `--control-plane --certificate-key ...`가 붙은 것: node2·3에서 쓸 명령
- 붙지 않은 것: 일반 워커용. 이번엔 안 씀

**이 출력은 클러스터에 들어올 수 있는 비밀번호와 같습니다.** 노드 안의 파일에만 저장하고, 저장소·채팅·스크린샷에 올리지 마세요.
`certificate-key`는 **2시간**, 토큰은 24시간 뒤 만료됩니다. 만료됐다면 「막혔을 때」를 보세요.

node1에서 `kubectl`을 쓸 수 있게 설정합니다.

```bash
mkdir -p $HOME/.kube
cp -i /etc/kubernetes/admin.conf $HOME/.kube/config

kubectl get nodes
```

`node1`이 `NotReady`로 보이면 **정상**입니다. 아직 Pod 네트워크(CNI)가 없기 때문이고, 3단계에서 `Ready`가 됩니다.

## 3단계 · Pod 네트워크 설치: Cilium (node1에서만)

Cilium CLI를 설치합니다. 설치 명령은 [Cilium 공식 문서의 Quick Installation](https://docs.cilium.io/en/stable/gettingstarted/k8s-install-default/)에 있는 것을 그대로 따릅니다(아키텍처별 다운로드 주소가 들어 있음).

```bash
CILIUM_VERSION=1.xx.x   # ← Cilium 최신 안정판으로 바꾸기

cilium install --version ${CILIUM_VERSION} --set ipam.mode=kubernetes
cilium status --wait    # 모든 항목이 OK가 될 때까지 기다림 (몇 분)
cilium hubble enable    # 트래픽 관찰 도구. 이후 실습에서 씀

kubectl get nodes       # node1 → Ready
```

`ipam.mode=kubernetes`는 2단계의 `--pod-network-cidr` 대역에서 Pod IP를 나눠 주라는 뜻입니다.

## 4단계 · node2, node3 합류

2단계에서 저장한 `--control-plane`이 붙은 join 명령에, **각 노드 자신의 IP**를 붙여 실행합니다.

```bash
# node2에서
kubeadm join k8s-api.lab:6443 --token <...> \
  --discovery-token-ca-cert-hash sha256:<...> \
  --control-plane --certificate-key <...> \
  --apiserver-advertise-address 10.10.0.12

# node3에서는 마지막 값을 10.10.0.13으로
```

node1에서 확인합니다.

```bash
kubectl get nodes -o wide   # node1~3 모두 Ready (Cilium이 자동으로 깔리기까지 1~2분)
```

sese2204에게 가비아 콘솔의 로드밸런서 상태 모니터링에서 세 노드가 모두 정상인지 확인해 달라고 하세요.

control-plane 노드에는 기본적으로 일반 Pod가 올라가지 않습니다. 우리는 세 대 모두 Pod도 돌리므로 이 제한(taint)을 풉니다.

```bash
kubectl taint nodes --all node-role.kubernetes.io/control-plane-
```

## 5단계 · 클러스터 확인

### 5-1. etcd 멤버 3개 확인 (node1에서)

```bash
kubectl -n kube-system exec etcd-node1 -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  member list -w table
```

`node1`, `node2`, `node3` 세 줄이 `started`로 나오면 됩니다.

### 5-2. 노드 간 통신 확인 (node1에서, 선택)

```bash
cilium connectivity test   # 5~10분. 전부 통과하면 노드 간 Pod 통신이 정상
kubectl get ns | grep cilium-test   # 끝나면 테스트용 네임스페이스를 확인하고 지움
kubectl delete ns <위에서 나온 cilium-test 네임스페이스들>
```

## 6단계 · 로컬 노트북에서 kubectl

API 포트(6443)를 인터넷에 열지 않고, **아무 노드나** 거쳐 로드밸런서로 가는 SSH 터널을 씁니다.

```bash
# 1) 노트북에 kubectl 설치 (macOS 예: brew install kubectl)

# 2) 접속 설정 파일 가져오기 — 이 파일도 비밀입니다
ssh root@<node1 공인 IP> 'cat /etc/kubernetes/admin.conf' > ~/.kube/ddia-lab.conf
chmod 600 ~/.kube/ddia-lab.conf

# 3) 노트북에서 k8s-api.lab을 내 컴퓨터(터널 입구)로 매핑
echo "127.0.0.1 k8s-api.lab" | sudo tee -a /etc/hosts

# 4) 터널 열기: 노트북 6443 → node 경유 → 로드밸런서 10.10.0.10:6443 (이 터미널은 켜 둠)
ssh -N -L 6443:10.10.0.10:6443 root@<node1 공인 IP>

# 5) 다른 터미널에서
export KUBECONFIG=~/.kube/ddia-lab.conf
kubectl get nodes
```

- 설정 파일 속 주소가 IP가 아니라 `k8s-api.lab`이라서 인증서 이름과 맞아떨어집니다. IP로 바꾸면 `x509` 인증서 오류가 납니다.
- node1이 꺼지면 4)의 `<node1 공인 IP>`만 node2 공인 IP로 바꿔 터널을 다시 엽니다. 로드밸런서는 살아 있는 노드로 보내 줍니다.

## 7단계 · 체험

이제부터는 로컬 노트북에서 해도 됩니다. 각 체험마다 **무엇을 보는지**가 핵심입니다. 관찰한 것을 한 줄씩 메모해 두세요.

아래 명령에 나오는 이미지 태그는 작성 시점 기준입니다. 이미지를 못 받아오면 Docker Hub에서 현재 태그를 확인하세요.

### 체험 1 · Pod 하나: 혼자 띄운 Pod는 죽으면 끝

```bash
kubectl run hello --image=nginx:1.27
kubectl get pods -o wide        # 어느 노드에, 어떤 IP로 떴나
kubectl describe pod hello      # 맨 아래 Events: 스케줄 → 이미지 받기 → 시작 순서
kubectl logs hello
kubectl delete pod hello
kubectl get pods                # 다시 생기지 않는다
```

**볼 것**: Pod는 "실행 중인 컨테이너"일 뿐이고, 지켜 주는 주체가 없습니다.

### 체험 2 · Deployment: 개수를 선언하면 쿠버네티스가 맞춘다

```bash
kubectl create deployment web --image=nginxdemos/hello:plain-text --replicas=3
kubectl get pods -o wide        # 3개가 여러 노드에 흩어져 뜸

# 다른 터미널에서 지켜보기
kubectl get pods -w

# 하나를 지워 본다
kubectl delete pod <web-로 시작하는 Pod 이름 하나>
```

**볼 것**: 지우자마자 새 Pod가 생깁니다. Deployment가 "3개"라는 **원하는 상태**와 지금 상태를 계속 비교해 맞추기 때문입니다.
DDIA 2장의 선언형 질의와 같은 생각입니다. 방법이 아니라 결과를 말하면 시스템이 맞춥니다.

```bash
kubectl scale deployment web --replicas=6   # 늘리기
kubectl scale deployment web --replicas=2   # 줄이기
```

### 체험 3 · 노드 간 통신과 Service

```bash
kubectl expose deployment web --port=80     # web이라는 Service 생성
kubectl get svc web                          # 고정 IP(CLUSTER-IP)가 붙음
kubectl get endpointslices -l kubernetes.io/service-name=web   # 그 뒤에 있는 Pod IP들

# 클러스터 안에 임시 Pod를 띄워 접속해 본다
kubectl run client --rm -it --image=busybox:1.36 -- sh
# 아래는 client 안에서
wget -qO- <다른 노드에 있는 web Pod의 IP>   # 노드가 달라도 Pod IP로 바로 통신
for i in 1 2 3 4 5 6; do wget -qO- web | grep "Server name"; done   # 이름으로 접속, 응답 서버가 바뀜
exit
```

**볼 것**:
- Pod IP는 노드가 달라도 바로 통신됩니다. Cilium이 해 주는 일입니다.
- Pod는 언제든 바뀌지만 Service 이름 `web`은 그대로입니다. 요청이 여러 Pod로 나뉘어 갑니다.

클러스터 밖(브라우저)에서 보고 싶으면 터널 없이도 이렇게 볼 수 있습니다. 인터넷 공개는 하지 않습니다.

```bash
kubectl port-forward svc/web 8080:80   # 노트북 브라우저에서 http://localhost:8080
```

### 체험 4 · 버전 교체(롤아웃)와 되돌리기

```bash
kubectl scale deployment web --replicas=3

# 정상 교체
kubectl set image deployment/web hello=nginxdemos/hello:latest
kubectl rollout status deployment/web
kubectl rollout history deployment/web

# 일부러 존재하지 않는 이미지로 교체
kubectl set image deployment/web hello=nginxdemos/hello:no-such-tag
kubectl get pods                 # 새 Pod는 ImagePullBackOff, 옛 Pod는 계속 살아 있음
kubectl rollout undo deployment/web
kubectl get pods                 # 원래대로
```

**볼 것**: 새 버전이 뜨지 못하면 옛 버전을 내리지 않습니다. 그래서 잘못된 배포를 해도 서비스가 바로 죽지 않습니다.

### 체험 5 · 선언형으로 관리하기: YAML

지금까지는 명령으로 바꿨지만, 실무에서는 원하는 상태를 파일로 적고 `apply`합니다.

```bash
kubectl get deployment web -o yaml > web.yaml   # 지금 상태를 파일로 보기
```

`web.yaml`에서 `replicas:` 값을 4로 고치고 적용합니다.

```bash
kubectl apply -f web.yaml
kubectl get deployment web       # READY 4/4
```

**볼 것**: 파일이 곧 원하는 상태입니다. 같은 파일을 몇 번 `apply`해도 결과가 같습니다(멱등).

### 체험 6 · 노드 장애

**서버 중지·시작은 콘솔 작업이라 sese2204에게 요청합니다.** 시간을 미리 맞춰 두세요.

먼저 계획된 점검(drain)을 해 봅니다.

```bash
kubectl get pods -o wide
kubectl drain node3 --ignore-daemonsets --delete-emptydir-data
kubectl get pods -o wide         # node3의 Pod가 다른 노드로 옮겨짐
kubectl uncordon node3           # 다시 받기 시작
```

이번엔 예고 없는 장애입니다. 터널을 **node2** 경유로 다시 연 뒤(6단계 4), sese2204에게 **node1 「중지」**를 요청하고, 다른 터미널에서 지켜봅니다.

```bash
kubectl get nodes -w
kubectl get pods -o wide -w
```

**볼 것**:
- node1이 꺼져도 `kubectl`이 동작합니다. 로드밸런서가 node1을 빼고 node2·3으로 보내고, etcd 3대 중 2대가 살아 있어 과반이 유지되기 때문입니다(9장 합의). 이게 「다 끝났다는 기준」의 다섯 번째 항목입니다.
- node1이 `NotReady`가 되기까지 수십 초가 걸립니다. 쿠버네티스는 노드가 죽었는지 느린지 구분하지 못해서, 일정 시간 응답이 없어야 죽었다고 판단합니다(DDIA 8장 타임아웃).
- node1의 Pod가 다른 노드로 옮겨지는 데는 기본 **약 5분**이 더 걸립니다. 잠깐 끊긴 노드 때문에 Pod를 성급하게 옮기지 않으려는 설정입니다.
- 로드밸런서 상태 모니터링에서 node1이 비정상으로 바뀌는 것도 sese2204에게 화면으로 받아 보세요.

끝나면 sese2204에게 node1 「시작」을 요청하고 `Ready`로 돌아오는지 확인합니다.

### 정리

```bash
kubectl delete deployment web
kubectl delete service web
```

## 인그레스 검토: 로드밸런서를 하나 더 달아야 하나

**결론: 1차에서는 달지 않습니다.** 이번 실습은 클러스터 안의 동작을 보는 것이고, 앱을 인터넷에 공개할 일이 없습니다. 밖에서 볼 때는 `kubectl port-forward`로 충분합니다.

나중에 앱을 공개해야 하면 아래를 알아 두세요.

- **`type: LoadBalancer` Service는 이 클러스터에서 자동으로 로드밸런서를 만들지 않습니다.** 가비아의 관리형 쿠버네티스에는 가비아(OpenStack) 연동 컨트롤러가 들어 있어 [자동으로 만들어지지만](https://customer.gabia.com/manual/cloud/23381/24281), kubeadm으로 직접 만든 클러스터에는 그 연동이 없습니다. EXTERNAL-IP가 계속 `<pending>`으로 남습니다.
- 그래서 직접 만든 클러스터에서는 아래 중 하나를 고릅니다.

| 방법 | 구성 | 추가 비용 (월, 부가세 별도) | 언제 |
|---|---|---|---|
| port-forward | 노트북 → kubectl 터널 | 0원 | 혼자 확인할 때 (1차 권장) |
| NodePort | Service를 NodePort로 열고, 보안 그룹에서 내 IP만 30000-32767 허용 | 0원 | 다른 사람도 잠깐 볼 때 |
| 인그레스 + 가비아 로드밸런서 | 인그레스 컨트롤러(예: Cilium Ingress)를 NodePort로 노출 → 공인 IP 붙인 가비아 로드밸런서(HTTP/HTTPS 리스너)가 세 노드의 NodePort로 분산 | 로드밸런서 15,000원 + 공인 IP 4,000원 | 도메인으로 계속 공개할 때 |

- 세 번째 방법도 로드밸런서와 노드의 연결은 콘솔에서 손으로 등록합니다. 노드가 늘거나 바뀌면 직접 고쳐야 합니다.
- 지금 단 API 서버용 로드밸런서는 **내부용**(공인 IP 없음)이라 앱 공개용으로 겸하지 않습니다. API 서버를 인터넷에 노출하지 않기 위해서입니다.

## 막혔을 때

| 증상 | 원인 | 해결 |
|---|---|---|
| `nc -zv k8s-api.lab 6443`이 시간 초과 | 로드밸런서 미생성 · 연결 서버 누락, 보안 그룹 | sese2204에게 0-5단계 연결 서버·포트와 0-3단계 서브넷 허용 규칙 확인 요청 |
| `kubeadm init`이 API 서버를 기다리다 멈춤 | 로드밸런서가 node1을 아직 비정상으로 봄 | sese2204에게 로드밸런서 상태 모니터링 확인 요청 (TCP 6443 모니터링인지, 연결 서버 포트가 6443인지) |
| `kubeadm init`이 swap 때문에 멈춤 | 스왑이 켜져 있음 | 1-3단계 `swapoff -a` |
| 설치 직후 노드가 `NotReady`, coredns가 `Pending` | CNI가 아직 없음 | 정상. 3단계 Cilium 설치 후 해결 |
| Pod·kubelet이 이유 없이 계속 재시작 | containerd cgroup 설정 누락 | 1-5단계 `SystemdCgroup = true` 확인 후 containerd·kubelet 재시작 |
| join 때 certificate key 오류 | 2시간이 지나 만료 | node1에서 `kubeadm init phase upload-certs --upload-certs`로 새 키, `kubeadm token create --print-join-command`로 새 명령 |
| 노드가 자기 자신을 로드밸런서로 거쳐 갈 때만 실패 | 로드밸런서가 요청 보낸 노드로 되돌려 보내지 못함(헤어핀) | 가비아 로드밸런서는 자체 IP로 중계하므로 문제없을 것으로 보지만 미검증. 생기면 sese2204에게 알림 |
| 다른 노드의 Pod IP로 통신 안 됨 | 보안 그룹에서 UDP 8472 차단, OS 방화벽 | 1-2단계 확인, `cilium status`. 그래도 안 되면 sese2204에게 0-3단계 UDP 규칙 확인 요청 |
| 노트북 kubectl에서 `x509` 오류 | IP로 접속함 | 6단계처럼 `k8s-api.lab` 이름으로 접속 |
| 노트북 kubectl이 `connection refused` | SSH 터널이 꺼짐, 경유 노드가 꺼짐 | 6단계 4)의 터널을 살아 있는 노드로 다시 열기 |
| `ssh root@...` 접속 거부 | 보안 그룹의 내 IP가 바뀜 | `curl ifconfig.me`로 확인한 새 IP를 sese2204에게 알림 |
| `ImagePullBackOff` | 이미지 이름·태그 오류 | `kubectl describe pod`의 Events에서 받으려던 이미지 확인 |

그래도 안 되면 `kubectl describe <대상>`의 **Events**와 `journalctl -u kubelet -n 100`을 붙여서 물어보세요. 문제는 대부분 여기에 적혀 있습니다.

## 하지 말 것, 먼저 확인받을 것

- **sese2204에게 요청하기**: 콘솔 작업 전부 (서버 중지·시작·종료·삭제·사양 변경, 보안 그룹·로드밸런서 수정). 체험 6의 node1 중지·시작도 sese2204에게 요청하거나, 콘솔 권한을 따로 받은 뒤 합니다.
- **먼저 확인받기**: `kubeadm reset`, 클러스터를 지우고 다시 만들기, 보안 그룹 규칙 넓히기, OS 방화벽 끄기
- **공개 금지**: join 명령(토큰·인증서 키), `admin.conf`, SSH 개인 키, 노드 공인 IP. 저장소·채팅·스크린샷에 올리지 않습니다.
- **열지 않기**: 6443을 포함해 22번 외의 포트를 `0.0.0.0/0`에 열지 않습니다.
- **고정**: 사용한 버전을 `versions.env`에 적어 둡니다. 2차 작업도 같은 버전으로 진행합니다.

```bash
# versions.env 예시
CLOUD="gabia-cloud-gen2"
K8S_VERSION=v1.xx.x
CILIUM_VERSION=1.xx.x
CONTAINERD_VERSION=x.x.x   # containerd --version
OS_IMAGE="Ubuntu 24.04 LTS"
ARCH=amd64                 # uname -m 으로 확인 (x86_64 = amd64)
```

## 실습이 끝나면: 자원 삭제

집중 실습 기간이 끝나면 sese2204가 콘솔에서 아래 순서로 삭제합니다. **삭제한 자원은 되돌릴 수 없습니다.** 받는 사람은 남길 것을 먼저 챙깁니다.

받는 사람이 삭제 전에 할 일:

- [ ] 체험 메모와 `versions.env`를 노트북이나 저장소에 옮겨 둠
- [ ] 노트북의 `~/.kube/ddia-lab.conf` 삭제, `/etc/hosts`의 `127.0.0.1 k8s-api.lab` 줄 삭제

sese2204가 콘솔에서 할 일 (요금이 나가는 것부터):

- [ ] 서버 node1 · node2 · node3 삭제
- [ ] 루트 스토리지 삭제 (서버와 함께 지워지지 않았다면 `[스토리지] > [블록 스토리지]`에서 확인)
- [ ] 공인 IP 3개 삭제 (서버 삭제 후에도 보유 IP로 남아 요금이 나갈 수 있음, `[네트워크] > [공인 IP]`에서 확인)
- [ ] 로드밸런서 `k8s-api` 삭제
- [ ] 보안 그룹 · 서브넷 · VPC 삭제 (무료지만 다음 차수에 새로 만들 때 헷갈리지 않게)
- [ ] 다음 날 청구 내역에서 시간 요금이 더 쌓이지 않는지 확인

다음 차수에 다시 할 때는 0단계부터 이 문서를 그대로 따르면 됩니다. 처음 하는 사람 기준 반나절이면 1~4단계까지 다시 올라옵니다.

## 처음부터 다시 해야 할 때

확인을 받은 뒤, 각 노드에서 실행합니다. **클러스터의 모든 상태가 지워집니다.**

```bash
kubeadm reset -f
rm -rf /etc/cni/net.d $HOME/.kube
```

그다음 2단계부터 다시 진행합니다. 0·1단계는 다시 할 필요가 없습니다.

## 다음 차수 (참고)

2차는 이 클러스터 위에 Postgres를 올립니다. StatefulSet으로 직접 한 대를 띄운 뒤 CNPG로 3대 복제를 구성합니다. 이 문서에서 만든 클러스터를 그대로 쓰고, 메모리가 모자라면 서버를 중지하고 Standard(2vCore · 8GB, 월 68,500원)로 사양을 올립니다.

## 참고 자료

- [가비아 클라우드 Gen2 매뉴얼](https://customer.gabia.com/manual/cloud/20444) — [서버 생성](https://customer.gabia.com/manual/cloud/20446/20447) · [보안 그룹](https://customer.gabia.com/manual/cloud/21566/21567) · [로드밸런서 생성](https://customer.gabia.com/manual/cloud/21069) · [서버 운영 상태(중지·종료 과금)](https://customer.gabia.com/manual/cloud/20446/20560)
- 가비아 클라우드 요금: [서버 · 공인 IP](https://www.gabiacloud.com/virtual_service/) · [블록 스토리지](https://www.gabiacloud.com/storage/cloudstorage/) · [로드밸런서](https://www.gabiacloud.com/loadbalancer/)
- [Kubernetes — Creating Highly Available Clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/)
- [Kubernetes — Installing kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/)
- [Kubernetes — Container Runtimes (containerd, cgroup driver)](https://kubernetes.io/docs/setup/production-environment/container-runtimes/)
- [Cilium — Quick Installation](https://docs.cilium.io/en/stable/gettingstarted/k8s-install-default/)
- [Cilium — Firewall Rules](https://docs.cilium.io/en/stable/operations/system_requirements/#firewall-rules)
