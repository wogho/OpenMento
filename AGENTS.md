# AGENTS.md

이 레포지토리에서 작업하는 인간 및 AI 기여자를 위한 가이드입니다.

## 1. 목적

OpenMento은 AI 에이전트 팀을 조직하여 교육 기관의 운영을 자동화하는 제어 플랫폼입니다.  
현재 구현 목표는 V1이며 `doc/SPEC.md`에 정의되어 있습니다.

## 2. 먼저 읽어야 할 것

변경을 가하기 전에 다음 순서로 읽으세요:

1. `doc/GOAL.md`
2. `doc/SPEC.md`
3. `doc/DEVELOPING.md`
4. `doc/DATABASE.md`
5. `doc/DEPLOYMENT.md`

## 3. 레포지토리 맵

```
server/          — Express REST API 및 에이전트 오케스트레이션 서비스
ui/              — React + Vite 대시보드 UI
packages/
  db/            — Drizzle 스키마, 마이그레이션, DB 클라이언트
  shared/        — 공유 타입, 상수, 검증기, API 경로 상수
  rag/           — RAG 파이프라인 (임베딩 생성 및 검색)
  rag-worker/    — BullMQ 기반 비동기 임베딩 워커
skills/          — 에이전트 스킬 파일 예시 (.md)
doc/             — 운영 및 제품 문서
tests/e2e/       — Playwright E2E 테스트
```

## 4. 개발 환경 설정

`DATABASE_URL` 환경변수가 **필수**입니다. Docker Compose로 로컬 DB를 올리거나 Supabase/Neon 등 외부 PostgreSQL URL을 `.env`에 지정하세요.

```sh
# Docker로 로컬 PostgreSQL 시작
docker compose up -d

# 또는 .env에 외부 DATABASE_URL 직접 지정
cp .env.example .env
```

```sh
pnpm install
pnpm dev
```

시작되는 서비스:

- API: `http://localhost:3100`
- UI: `http://localhost:5173/` (Vite dev server)

빠른 헬스 체크:

```sh
curl http://localhost:3100/api/health
```

로컬 개발 DB 초기화:

```sh
# docker-compose 사용 시
docker compose down -v && docker compose up -d
pnpm dev
```

## 5. 핵심 아키텍처 원칙

### 원자적 작업 체크아웃

에이전트가 작업을 체크아웃할 때 예산 적용이 원자적으로 처리됩니다. 중복 작업과 예산 초과를 방지합니다.

### 멀티 테넌시 격리

모든 DB 쿼리는 반드시 `institution_id`로 범위를 지정해야 합니다. 쿼리에서 기관 필터를 누락하면 데이터 격리가 깨집니다.

```ts
// 올바른 예
const tasks = await db.query.tasks.findMany({
  where: eq(tasks.institutionId, institutionId),
});

// 잘못된 예 — 절대 하지 말 것
const tasks = await db.query.tasks.findMany();
```

### 감사 로그 불변성

에이전트 도구 호출 로그와 티켓 기록은 불변입니다. 생성 후에는 수정하거나 삭제하지 않습니다.

### RAG 파이프라인 비동기 처리

임베딩 생성은 BullMQ 큐를 통해 비동기로 처리됩니다. API 핸들러에서 직접 임베딩을 생성하지 않습니다.

```ts
// 올바른 예 — 큐에 추가
await embeddingQueue.add('embed-document', { documentId, institutionId });

// 잘못된 예 — API 핸들러에서 직접 임베딩 생성 금지
const embedding = await openai.embeddings.create({ ... }); // 핸들러에서 직접 X
```

## 6. 자주 발생하는 실수

| 실수 | 올바른 방법 |
| ---- | ----------- |
| `institution_id` 없는 DB 쿼리 | 모든 쿼리에 `institution_id` 범위 지정 |
| API 핸들러에서 직접 임베딩 생성 | BullMQ 큐에 작업 추가 |
| 에이전트 감사 로그 수정 | 로그는 추가 전용(append-only) |
| 환경변수를 코드에 하드코딩 | `.env` 또는 시크릿 관리 서비스 사용 |
| `DATABASE_URL` 없이 외부 DB 연결 | 환경변수 설정 확인 |

## 7. 테스트

```sh
pnpm test:run         # 전체 테스트 실행
pnpm typecheck        # 타입 검사
pnpm lint             # ESLint 검사

# E2E 테스트만 실행
pnpm exec playwright test
```

PR을 제출하기 전에 모든 테스트가 통과하는지 확인하세요.

## 8. 커밋 컨벤션

[Conventional Commits](https://www.conventionalcommits.org/) 형식을 따릅니다:

```
feat(rag): 유사도 임계값 기관별 설정 기능 추가
fix(heartbeat): 에이전트 재시작 시 컨텍스트 누락 문제 수정
docs(spec): RAG 파이프라인 아키텍처 명세 업데이트
refactor(db): 멀티 테넌시 쿼리 헬퍼 추출
```

## 9. 스킬 파일

`skills/` 디렉터리에 에이전트 스킬 파일 예시가 있습니다. 에이전트에게 플랫폼 워크플로우를 가르치는 데 사용됩니다.

새로운 스킬 파일을 추가할 때:

- 마크다운 형식으로 작성합니다.
- 구체적인 예시와 함께 단계별 지침을 포함합니다.
- 교육 도메인 컨텍스트를 명확히 합니다.
