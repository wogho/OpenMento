# Docker 가이드

Node나 pnpm을 로컬에 설치하지 않고 Docker로 OpenMento을 실행합니다.

모든 명령어는 **프로젝트 루트** (`package.json`이 있는 디렉터리)에서 실행합니다.

## 이미지 빌드

```sh
docker build -t openmento-local .
```

빌드 인수:

| 인수 | 기본값 | 설명 |
|-----|---------|------|
| `USER_UID` | `1000` | 컨테이너 node 사용자 UID (권한 문제 방지를 위해 호스트 UID와 일치시킬 것) |
| `USER_GID` | `1000` | 컨테이너 node 그룹 GID |

```sh
docker build -t openmento-local \
  --build-arg USER_UID=$(id -u) --build-arg USER_GID=$(id -g) .
```

## 원클릭 (빌드 + 실행)

```sh
docker build -t openmento-local . && \
docker run --name openmento \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e OPENMENTO_HOME=/openmento \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -v "$(pwd)/data/docker-openmento:/openmento" \
  openmento-local
```

열기: `http://localhost:3100`

바인드 마운트에 다음이 영속됩니다:

- 임베디드 PostgreSQL 데이터
- 업로드된 교육 자료
- 로컬 시크릿 키
- 에이전트 워크스페이스 데이터

## Docker Compose

### 빠른 시작 (임베디드 DB)

단일 컨테이너, 외부 데이터베이스 불필요:

```sh
BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  docker compose -f docker/docker-compose.quickstart.yml up --build
```

### 전체 스택 (외부 PostgreSQL + pgvector)

```sh
cp .env.example .env
# .env에서 BETTER_AUTH_SECRET 및 AI API 키 설정

docker compose up --build
```

이렇게 하면 다음이 시작됩니다:

- `openmento-api`: Node.js API 서버 (포트 3100)
- `openmento-db`: PostgreSQL 16 + pgvector (포트 5432)
- `openmento-worker`: BullMQ RAG 임베딩 워커
- `openmento-redis`: BullMQ 브로커 (포트 6379)

### pnpm Docker 명령어

```sh
pnpm docker:up      # 전체 스택 시작 (백그라운드)
pnpm docker:down    # 전체 스택 중단
pnpm docker:logs    # 컨테이너 로그 확인
pnpm docker:reset   # 볼륨 포함 완전 초기화 (데이터 삭제)
```

## 데이터 영속화

컨테이너 재시작 후에도 데이터를 유지하려면 볼륨을 마운트합니다:

```yaml
# docker-compose.yml 일부
volumes:
  - openmento-data:/openmento
  - pgdata:/var/lib/postgresql/data
```

## 헬스 체크

```sh
curl http://localhost:3100/api/health
```

정상 응답:

```json
{ "status": "ok", "db": "connected", "vector": "enabled" }
```

## 프로덕션 고려사항

- `BETTER_AUTH_SECRET`은 최소 32바이트의 랜덤 값을 사용합니다.
- 프로덕션에서는 반드시 외부 PostgreSQL을 사용하고 `pgvector` 확장을 활성화합니다.
- Redis는 BullMQ 큐에 필요합니다. 관리형 Redis(예: Upstash)를 사용하는 것을 권장합니다.
- 컨테이너 이미지에 AI API 키를 직접 포함하지 마십시오. 환경변수 또는 시크릿 관리 서비스를 사용합니다.
