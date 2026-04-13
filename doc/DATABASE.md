# 데이터베이스

OpenMento은 [Drizzle ORM](https://orm.drizzle.team/)을 통해 PostgreSQL을 사용합니다. 간단한 방법부터 프로덕션 수준까지 세 가지 실행 방법을 지원합니다.

## 1. 로컬 PostgreSQL (Docker) — 권장

`DATABASE_URL` 환경변수가 **필수**입니다. 설정되지 않으면 `packages/db/src/client.ts`에서 에러를 던지며 서버가 시작되지 않습니다.

Docker Compose로 로컬 PostgreSQL을 빠르게 시작할 수 있습니다:

```sh
docker compose up -d
cp .env.example .env
pnpm db:migrate
pnpm dev
```

최초 시작 시 Drizzle이 스키마 마이그레이션을 자동 적용합니다.

로컬 개발 데이터 초기화:

```sh
docker compose down -v && docker compose up -d
pnpm db:migrate
```

## 2. 로컬 PostgreSQL (Docker)

전체 PostgreSQL 서버를 로컬에서 사용하려면 Docker Compose를 사용합니다:

```sh
docker compose up -d
```

`localhost:5432`에 PostgreSQL 16이 시작됩니다. 그런 다음 연결 문자열을 설정합니다:

```sh
cp .env.example .env
# .env에 이미 포함된 내용:
# DATABASE_URL=postgres://openmento:openmento@localhost:5432/openmento
```

마이그레이션을 실행합니다:

```sh
pnpm db:migrate
```

서버를 시작합니다:

```sh
pnpm dev
```

## 3. 호스팅 PostgreSQL (프로덕션)

프로덕션 환경에서는 관리형 PostgreSQL 서비스를 사용합니다. [Supabase](https://supabase.com/) 또는 [Neon](https://neon.tech/)이 좋은 옵션입니다.

### pgvector 확장 활성화

OpenMento의 RAG 파이프라인은 `pgvector` 확장을 필요로 합니다. 호스팅 환경에서 반드시 활성화해야 합니다.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Supabase는 대시보드의 **Database → Extensions**에서 `vector`를 활성화할 수 있습니다.

### Supabase 설정

1. [database.new](https://database.new)에서 프로젝트 생성
2. **Project Settings → Database → Connection string** 이동
3. URI를 복사하고 비밀번호 플레이스홀더를 실제 비밀번호로 교체

### 연결 문자열

Supabase는 두 가지 연결 모드를 제공합니다:

**직접 연결** (포트 5432) — 마이그레이션 및 일회성 스크립트에 사용:

```
postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

**연결 풀링** (포트 6543) — 프로덕션 API 서버에 사용:

```
postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

## 스키마 구조

```
packages/db/
├── schema/
│   ├── institutions.ts   # 교육 기관 (멀티 테넌시)
│   ├── agents.ts         # 에이전트 등록 및 조직도
│   ├── tasks.ts          # 작업 및 티켓 시스템
│   ├── heartbeats.ts     # 에이전트 하트비트 로그
│   ├── budgets.ts        # 비용 추적 및 예산 관리
│   ├── knowledge.ts      # RAG 지식 베이스 (pgvector)
│   └── portfolios.ts     # 수강생 포트폴리오 제출
├── migrations/           # Drizzle 마이그레이션 파일
└── index.ts              # DB 클라이언트 및 스키마 export
```

## 마이그레이션 워크플로우

스키마를 변경한 후:

```sh
# 1. 마이그레이션 파일 생성
pnpm db:generate

# 2. 마이그레이션 검토 (packages/db/migrations/)

# 3. 마이그레이션 적용
pnpm db:migrate
```

**주의:** 프로덕션 마이그레이션은 항상 백업 후 실행하고, 롤백 계획을 수립합니다.

## 임베딩 벡터

RAG 파이프라인에서 사용하는 임베딩은 `packages/rag/` 패키지에서 관리됩니다.

- 벡터 차원: 1536 (OpenAI `text-embedding-3-small` 기준)
- 유사도 함수: 코사인 유사도 (`<=>` 연산자)
- 인덱스: `ivfflat` (100만 건 이하) / `hnsw` (대규모)

```sql
-- 예시: 유사 포트폴리오 검색
SELECT id, title, 1 - (embedding <=> $1) AS similarity
FROM portfolio_submissions
WHERE institution_id = $2
ORDER BY embedding <=> $1
LIMIT 10;
```
