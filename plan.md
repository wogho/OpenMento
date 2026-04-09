# EduClip — AI 교육 플랫폼 구축 계획서

> **프로젝트명**: EduClip — 다중 에이전트 오케스트레이션 기반 AI 교육 자율 운영 플랫폼  
> **기술 기반**: Node.js 20+ / TypeScript / PostgreSQL 16+ / pgvector / React 18+ / Docker Compose  
> **참조 오픈소스**: [paperclip (MIT License)](https://github.com/paperclipai/paperclip) — DB 스키마·서비스 구조 직접 차용

---

## 전체 로드맵 개요

```
Phase 0  ── 환경 구성 및 코드베이스 초기화          (1~2주)
Phase 1  ── AI 튜터 MVP (기능 3)                   (1~2개월)
Phase 2  ── EWS 위험 감지 시스템 (기능 2)           (3~4개월)
Phase 3  ── Runtime Skill Injection AI 강사 (기능 1)(5~6개월)
Phase 4  ── 포트폴리오 차별화 시스템 (기능 4)        (7~9개월)
Phase 5  ── 고도화 및 다기관 확산                   (10개월~)
```

---

## Phase 0 — 환경 구성 및 코드베이스 초기화

> **목표**: 개발 환경을 완성하고 paperclip 구조를 기반으로 프로젝트 골격을 세운다.  
> **기간**: 1~2주

### 0-1. 모노레포 초기화 (pnpm workspace)

```
our-project/
├── packages/
│   ├── db/           # Drizzle ORM 스키마 (paperclip 차용 + 교육기관 도메인 추가)
│   ├── shared/       # 공유 타입 및 유틸리티
│   └── rag/          # RAG 파이프라인 (pgvector 연동, 신규)
├── server/           # Node.js 20+ API + 에이전트 오케스트레이터
├── ui/               # React 18+ 대시보드 (Tailwind CSS)
├── skills/           # 스킬 파일 예시 (.md)
│   ├── java-spring/
│   ├── python-django/
│   └── react-next/
├── docker/
│   └── docker-compose.yml
├── pnpm-workspace.yaml
└── .env.example      # 환경변수 템플릿 (실제 값은 GUI Secrets Manager에서 관리)
```

**작업 항목**:
- [x] `pnpm init` + `pnpm-workspace.yaml` 설정 — `educlip/pnpm-workspace.yaml`
- [x] TypeScript `tsconfig.json` 기본 설정 (각 패키지별 extends 구조) — `tsconfig.base.json` + 패키지별 extends
- [x] ESLint + Prettier 공통 설정 — `.eslintrc.json`, `.prettierrc.json`
- [x] GitHub 레포지토리 생성 및 초기 커밋

---

### 0-2. Docker Compose 환경 구성

```yaml
# docker-compose.yml
services:
  api:          # Node.js API + 에이전트 오케스트레이터 (포트 3000)
  db:           # PostgreSQL 16 + pgvector 0.7+ 확장 (포트 5432)
  ui:           # React 빌드 결과물 서빙 Nginx (포트 80/443)
  mcp-gateway:  # MCP 프로토콜 게이트웨이 (포트 3001)
```

**작업 항목**:
- [x] `docker-compose.yml` 작성 (서비스 4개)
- [x] PostgreSQL 초기화 스크립트 (`init.sql`: pgvector 확장 설치)
- [x] `docker compose up` 단일 명령 전체 구동 검증
- [x] 개발용 hot-reload 환경 구성 (nodemon / Vite)

---

### 0-3. DB 스키마 초기화 (paperclip 차용)

paperclip의 스키마를 기반으로 교육기관 도메인 테이블을 추가합니다.

**paperclip에서 직접 복사** (`packages/db/src/schema/`):

| 파일 | 차용 방식 | 수정 내용 |
|---|---|---|
| `agents.ts` | 직접 복사 | `institutionId` FK 추가 |
| `heartbeat_runs.ts` | 직접 복사 | `institutionId` FK 추가 |
| `routines.ts` + `routine_triggers.ts` | 직접 복사 | `courseId` FK 추가 |
| `company_skills.ts` → `instructor_skills.ts` | 복사 후 리네임 | `companyId` → `institutionId` |
| `goals.ts` | 직접 복사 | 변경 없음 |
| `budget_policies.ts` + `cost_events.ts` | 직접 복사 | 소폭 수정 |

**신규 설계 테이블**:

| 테이블명 | 역할 |
|---|---|
| `institutions` | 교육기관 정보 (companies 확장) |
| `courses` | 강의 과정 (Java반, Python반) |
| `students` | 수강생 정보 (익명 ID + 실명 분리) |
| `attendance_logs` | 출결 기록 (MCP 외부 연동) |
| `assignment_submissions` | 과제 제출 이력 |
| `ews_risk_scores` | EWS 위험 점수 이력 |
| `rag_documents` | RAG 교재 청크 + pgvector |
| `portfolio_projects` | 포트폴리오 기획서 |
| `portfolio_similarity_logs` | 유사도 분석 이력 |
| `audit_logs` | 에이전트 외부 접근 감사 로그 |

**작업 항목**:
- [x] Drizzle ORM 설치 및 `packages/db/src/client.ts` 구성
- [x] 위 스키마 파일 전체 작성
- [x] `drizzle-kit generate` + `drizzle-kit migrate` 실행
- [x] 시드 데이터 스크립트 작성 (개발용 샘플 데이터)

> ⚠️ **마이그레이션 주의 (Gemini 제언 반영)**: paperclip 차용 스키마에 `institutionId`, `courseId` 등 멀티 테넌트 컬럼을 추가하는 작업은 TypeScript 타입 완결성과 시딩 스크립트 작성까지 포함하여 예상보다 공수가 높습니다. Phase 0에 충분한 QA 기간을 배정하고, `drizzle-kit push` 대신 마이그레이션 파일을 명시적으로 관리하여 롤백 경로를 확보하십시오.

---

### 0-4. 인증 기초 구조

- [x] JWT 인증 미들웨어 구성 (paperclip `agent-auth-jwt.ts` 참조)
- [x] RBAC 라우트 구조 설정: `/student/*`, `/instructor/*`, `/admin/*`
- [x] 역할별 접근 권한 정의 미들웨어 작성

---

## Phase 1 — AI 튜터 MVP (기능 3)

> **목표**: 수강생이 교재 기반 소크라테스식 답변을 받는 AI 튜터를 출시한다.  
> **기간**: 1~2개월차  
> **우선 이유**: 별도 하드웨어 투자 없이 구현 가능하며 수강생 만족도를 즉각 높여 도입 명분을 확보

---

### 1-1. RAG 파이프라인 구축 (`packages/rag/`)

```
[원천 데이터: PDF 교재, 기출문제, 강의노트]
        ↓
[문서 파싱 → 청킹 (512 token 단위)]
        ↓
[임베딩 모델 → 벡터 변환]
        ↓
[pgvector에 저장 (rag_documents 테이블)]
        ↓
[수강생 질문 → 유사도 검색 (Cosine Similarity)]
        ↓
[관련 컨텍스트 + 소크라테스식 프롬프트 조합 → LLM 전달]
```

**작업 항목**:
- [x] `packages/rag/` 패키지 생성
- [x] PDF 파싱 라이브러리 연동 (`pdf-parse` 또는 `pdfjs-dist`)
- [x] 마크다운 파싱 및 청킹 로직 구현 (512 토큰 단위, 오버랩 50 토큰)
- [x] OpenAI `text-embedding-3-small` 기반 임베딩 생성 함수 구현
- [x] pgvector `cosine_distance` 검색 쿼리 구현
- [x] `worker_threads`로 임베딩 작업을 메인 서버와 비동기 분리 (서버 블로킹 방지)
- [x] RAG 문서 등록 REST API 구현 (`POST /admin/documents`)

---

### 1-2. AI 튜터 에이전트 구현

**작업 항목**:
- [x] 에이전트 기본 클래스 구현 (paperclip `heartbeat.ts` 상태 머신 참조)
- [x] 소크라테스식 답변 System Prompt 템플릿 작성
  - "정답 코드를 직접 주지 않는다"
  - "교재 N페이지의 개념을 인용한다"
  - "질문으로 사고를 유도한다"
- [x] RAG 컨텍스트 주입 로직 (상위 3개 청크를 프롬프트에 삽입)
- [x] Multi-turn 대화 이력 관리 (PostgreSQL `conversation_messages` 테이블)
- [x] LLM 어댑터 구현 (OpenAI / Anthropic 교체 가능한 인터페이스, paperclip `adapters/` 참조)
- [x] 에이전트별 `adapterConfig` JSON으로 모델 선택 (GPT-4o, Claude Haiku 등)
- [x] `fallbackAdapterConfig` 필드 추가 (LLM 장애 시 백업 벤더 자동 전환)

---

### 1-3. MCP 게이트웨이 기초

**작업 항목**:
- [x] MCP 게이트웨이 서비스 기본 구조 작성 (`server/src/mcp/`)
- [x] LMS Read-only 커넥터 구현 (강의 진도, 수강 시간, 퀴즈 점수)
- [x] 출결 시스템 Read-only 커넥터 구현
- [x] OAuth 2.0 / API Key 인증 방식 추상화 (어댑터 패턴)
- [x] 감사 로그 기록 (`audit_logs` 테이블에 모든 외부 접근 이력 저장)

---

### 1-4. 수강생 포털 UI (Phase 1 범위)

**작업 항목**:
- [x] React 프로젝트 초기화 (`ui/` 폴더, Vite + Tailwind CSS)
- [x] 카카오톡 형태 AI 채팅 UI 컴포넌트 구현
  - 사용자 메시지 / AI 응답 말풍선
  - "AI가 답변 중..." 타이핑 인디케이터 (WebSocket)
  - 교재 페이지 인용 시 하이퍼링크 연결
- [x] WebSocket 실시간 스트리밍 응답 연결 (socket.io)
- [x] 수강생 로그인 / JWT 인증 플로우 UI
- [x] 모바일 반응형 레이아웃 (320px~1920px)
- [x] PWA(Progressive Web App) 기초 설정 (`manifest.json`, Service Worker)

---

### 1-5. 관리자 GUI — 교재 업로드 (Phase 1 범위)

**작업 항목**:
- [x] 관리자 설정 허브 기본 레이아웃 (탭 구조)
- [x] 교재 드래그앤드롭 업로드 UI (`react-dropzone`)
  - 업로드 진행률 표시
  - 처리 상태 인디케이터 (처리 중 / 완료 / 오류)
- [x] 등록된 교재 목록 조회 + 삭제 UI
- [x] 보안 키 관리 페이지 (API 키 마스킹 저장, `PUT /admin/secrets`)

---

### 1-6. E2E 테스트 기반 구축 (Phase 1 후반, Gemini 제언 반영)

에이전트가 개입하는 흐름은 단위 테스트만으로 검증이 불충분합니다. Phase 1 후반부에 E2E 테스트 기반을 미리 구성하여 Phase 2~4 품질을 조기 확보합니다.

**작업 항목**:
- [x] Playwright 설치 및 테스트 프로젝트 초기화 (`tests/e2e/`)
- [x] 수강생 로그인 → AI 튜터 질문 → 답변 수신 시나리오 테스트 작성
- [x] 교재 업로드 → 임베딩 완료 → RAG 검색 응답 포함 여부 시나리오 테스트 작성
- [x] CI 파이프라인 (GitHub Actions)에 E2E 테스트 단계 추가

---

### Phase 1 완료 기준 (Definition of Done)

- [x] 수강생이 질문 입력 시 교재 기반 소크라테스식 답변 수신 가능
- [x] 강사/관리자가 GUI에서 PDF 교재 업로드 → AI 자동 학습 완료
- [x] API 키를 `.env` 파일 없이 GUI에서 저장 가능
- [x] `docker compose up` 단일 명령으로 전체 환경 구동 확인
- [x] Playwright E2E 기본 시나리오 2개 이상 통과

---

## Phase 2 — EWS 중도탈락 위험 감지 시스템 (기능 2)

> **목표**: Heartbeat 스케줄링 기반 위험 수강생 자동 감지 및 알림 시스템을 출시한다.  
> **기간**: 3~4개월차

---

### 2-1. Heartbeat 스케줄러 구현

paperclip `server/src/services/heartbeat.ts`의 상태 머신을 교육기관 도메인에 맞게 재구현합니다.

```
에이전트 생명주기:
  queued → wakeup → running → completed/failed → sleep
```

**작업 항목**:
- [x] paperclip `cron.ts` 전체 복사 (5-field 독립 cron 파서, 외부 라이브러리 없음)
- [x] `routines` + `routine_triggers` 테이블 기반 스케줄 실행 엔진 구현
- [x] 동시 실행 제한 로직 (`HEARTBEAT_MAX_CONCURRENT_RUNS`, 기본 1, 최대 10)
- [x] 중복 실행 방지 락 (`startLocksByAgent` Map + `executionLockedAt`)
- [x] `heartbeat_runs` 테이블에 실행 이력 저장 (`usageJson`, `stdoutExcerpt`, `resultJson`)
- [x] 실패 시 자동 재시도 (`retryOfRunId` + `processLossRetryCount`)
- [x] 단기 JWT 발급 패턴 (paperclip `agent-auth-jwt.ts` 차용, 실행 시에만 유효한 토큰)

---

### 2-2. EWS 위험 점수 산출 로직

**위험 점수 계산 (총 100점)**:

| 요소 | 가중치 | 임계 조건 |
|---|---|---|
| 출석률 | 40% | 최근 5일 중 2일 이상 결석 |
| 과제 미제출 | 35% | 최근 3개 중 2개 미제출 |
| 강사 상담 이력 | 15% | 최근 2주 내 부정적 상담 기록 |
| AI 튜터 활용 감소 | 10% | 전주 대비 접속 빈도 50% 이하 |

**작업 항목**:
- [x] EWS 모니터 에이전트 클래스 구현
- [x] 위험 점수 산출 쿼리 구현 (PostgreSQL 집계 쿼리)
- [x] `ews_risk_scores` 테이블에 점수 이력 저장
- [x] Human-in-the-loop 피드백 저장 (강사가 "오탐"으로 표시 → 임계치 자동 보정 기반 데이터 수집)

---

### 2-3. Heartbeat 주기 설정

**3단계 Heartbeat 주기**:

| 주기 | 작업 | 구현 방식 |
|---|---|---|
| 매 1시간 | 당일 출결 즉각 스캔 | `routine_triggers(kind="cron")`, `0 * * * *` |
| 매일 오전 7시 | 전일 종합 위험 점수 산출 + 일일 리포트 | `0 7 * * *` |
| 매주 월요일 오전 9시 | 주간 트렌드 분석 + 주간 보고서 | `0 9 * * 1` |

**작업 항목**:
- [x] 3개 routine + routine_trigger 레코드 초기 시드 데이터 작성
- [x] Heartbeat 실행 → EWS 위험 점수 산출 → 임계치 판단 플로우 구현
- [x] Slack Webhook 알림 발송 함수 구현

---

### 2-4. 알림 에스컬레이션 시스템

```
위험 점수 60점 이상 → 담당 강사 Slack 알림
위험 점수 75점 이상 → 강사 + 원장 Slack + 멘탈케어 에이전트 자동 안부 메시지
위험 점수 90점 이상 → 전 단계 + 즉시 전화 상담 예약 자동 생성
```

**작업 항목**:
- [x] 멘탈케어 에이전트 구현 (공감적 어조 안부 메시지 생성)
- [x] Slack Webhook 연동 (`/admin/secrets`에 저장된 키 참조)
- [x] 상담 예약 자동 생성 API 구현

---

### 2-5. GitHub Webhook 기반 Proactive Interaction

paperclip `routine_triggers(kind="webhook")` 구조 활용.

```
[수강생 GitHub → 과제 레포 push/PR 이벤트]
        ↓
[POST /webhook/github 수신]
        ↓
[routine_triggers(kind="webhook") 매칭 → 에이전트 wakeup 요청]
        ↓
[AI 강사 에이전트 기상 → 커밋 diff 분석 → 코드 리뷰 생성]
        ↓
[수강생 포털 채팅창 WebSocket Push: "코드 리뷰가 도착했습니다"]
```

**작업 항목**:
- [x] GitHub Webhook 수신 엔드포인트 구현 (`POST /webhook/github`)
- [x] Webhook 서명 검증 (HMAC-SHA256, 보안 필수)
- [x] Webhook 이벤트 → routine_triggers 매칭 로직 구현
- [x] 커밋 diff 분석 프롬프트 작성
- [x] **[개선①]** BullMQ + Redis 기반 비동기 큐 전환 (`queues/webhook.queue.ts`, `queues/webhook.worker.ts`)
  - REDIS_URL 없으면 자동으로 in-process fallback 사용
  - Docker Compose에 Redis 7 서비스 추가
- [x] **[개선②]** Zod 런타임 페이로드 검증 (`GitHubPushPayloadSchema`, `GitHubPrPayloadSchema`)
- [x] **[개선③]** BullMQ 내장 Exponential Backoff (attempts: 4, delay: 2s→4s→8s)
- [x] **[개선④]** Budget Guard 연동 준비 (`services/budget-guard.ts`, Phase 2-7 완성 시 실제 잔액 체크)

---

### 2-6. 원장/강사 대시보드 UI (Phase 2 범위)

**작업 항목**:
- [x] 원장 대시보드 구현
  - KPI 카드 (전체 출석 / 위험 수강생 수 / 이번 달 AI 비용)
  - EWS 위험 수강생 목록 (클릭 → 상담 예약 / 안부 메시지 발송)
  - 모바일 반응형 필수
- [x] 강사 대시보드 구현
  - 담당 수강생 현황 조회
  - 강사별 위험 수강생 목록
  - 오탐 피드백 입력 버튼 (Human-in-the-loop)
- [x] 관리자 GUI — 스케줄 설정기
  - cron 표현식 대신 드롭다운·체크박스·시각적 스케줄 선택기
  - "매일 오전 7시", "매주 월요일" 등 자연어 미리보기
- [x] 관리자 GUI — EWS 임계치 슬라이더
  - 가중치 합계 100% 자동 검증
  - 변경 즉시 DB 반영 (`PUT /admin/thresholds`)
- [x] 관리자 GUI — 알림 채널 설정
  - Slack Webhook URL 입력 + 연결 테스트 버튼
  - 알림 에스컬레이션 임계치 슬라이더

---

### 2-7. 예산 관리 구현

paperclip `server/src/services/budgets.ts` + `budget_policies` + `cost_events` 테이블 차용.

**작업 항목**:
- [x] 비용 추적 미들웨어 구현 (LLM 응답 후 토큰 수 → `cost_events` 저장)
- [x] 에이전트별 월 예산 상한 초과 시 자동 일시정지 로직
- [x] **예산 80% 도달 시 Soft Alert 발송** (Gemini 제언 반영): 100% 강제 정지 전에 원장에게 선제적 경고 알림 발송
- [x] 관리자 GUI — 예산 관리 페이지
  - 전체 / 에이전트별 월 소비 게이지 바
  - 예산 80% 경고 알림 임계치 설정 토글 (기본값: 활성)
  - 예산 초과 시 동작 설정 (자동 정지 / 알림만)
- [x] **[개선①]** 월별 예산 정지 에이전트 자동 재활성화 크론 구현
- [x] **[개선②]** Redis 기반 월 소비 집계 캐싱 처리 (최적화)
- [x] **[개선③]** `cost_events` Bulk Insert 인메모리 버퍼 설계 (최적화)
- [x] **[개선④]** DB 기반 모델별 단가(`model_pricing`) 동적 관리 및 UI 적용

---

### Phase 2 완료 기준 (Definition of Done)

- [x] EWS 에이전트가 매시간·매일·매주 Heartbeat 주기로 자동 실행 확인
- [x] 위험 점수 임계치 초과 수강생 발생 시 Slack 알림 수신 확인
- [x] 원장이 GUI에서 임계치·스케줄을 코드 수정 없이 변경 가능 (ews-thresholds.ts 공유 모듈 연결)
- [x] GitHub push 이벤트 발생 시 수강생 포털에 코드 리뷰 자동 도착 확인
- [x] 예산 초과 시 에이전트 자동 일시정지 동작 확인

---

## Phase 3 — Runtime Skill Injection AI 강사 (기능 1)

> **목표**: 강사 노하우가 담긴 스킬 파일을 GUI에서 관리하고 AI 강사에게 즉시 주입한다.  
> **기간**: 5~6개월차

---

### 3-1. Skill Injection 엔진 구현

paperclip `server/src/services/company-skills.ts` 참조하여 `instructor_skills` 도메인에 맞게 재구현.

```
[DB의 instructor_skills.markdown 조회]
        ↓
[에이전트 System Prompt 앞부분에 스킬 markdown 삽입]
        ↓
[에이전트가 해당 컨벤션·규칙 준수하여 응답 생성]
```

**작업 항목**:
- [x] `instructor_skills` 테이블 CRUD API 구현 (`GET/POST/PUT/DELETE /admin/skills`)
- [x] System Prompt 동적 빌드 함수 구현 (스킬 markdown + RAG 컨텍스트 결합)
  - `buildSystemPrompt(agentId, instructionId)` — 스킬 + RAG 컨텍스트 조합
  - 기존 AI 튜터 / EWS 에이전트 핸들러에 이 함수 적용
- [x] GitHub에서 스킬 파일 자동 임포트 기능 (`importSkillFromGitHub()` 참조)
- [x] `sourceRef`로 Git 커밋 해시 추적 (스킬 파일 버전 관리)
- [x] 스킬 파일 변경 시 실행 중인 에이전트 핫 리로드 (재배포 없이 반영)
  - `PUT /admin/skills/:id` 수신 시 해당 `agentId`의 System Prompt 캐시 무효화
  - 이후 요청부터 새 스킬 markdown 적용됨
- [x] **[Phase 2 연계]** `ews_settings` 임계치 캐시 프리워밍 정상 동작 통합 테스트 추가

---

### 3-2. 에이전트 조직 구조 구성

paperclip `agents.ts`의 `reportsTo` FK를 활용하여 계층 조직도 구성.

**에이전트 등록 목록**:

| 에이전트명 | role | reportsTo | 모델 |
|---|---|---|---|
| 오케스트레이터 | `orchestrator` | (없음) | GPT-4o |
| EWS 모니터 | `ews_monitor` | 오케스트레이터 | GPT-4o mini |
| AI 강사 (Java반) | `ai_instructor` | 오케스트레이터 | Claude Haiku |
| AI 강사 (Python반) | `ai_instructor` | 오케스트레이터 | Claude Haiku |
| AI 튜터 | `ai_tutor` | AI 강사 | Claude Haiku |
| 멘탈케어 에이전트 | `mental_care` | EWS 모니터 | Claude Haiku |
| 포트폴리오 심사 | `portfolio_reviewer` | 오케스트레이터 | GPT-4o |

**작업 항목**:
- [x] 위 에이전트 초기 시드 데이터 작성
- [x] 에이전트별 `adapterConfig` 설정 (모델, API 키 참조)
- [x] `fallbackAdapterConfig` 추가 (장애 시 백업 벤더 자동 전환)

---

### 3-3. LLM 모델 라우팅 전략

**에이전트별 최적 모델 배분**:

| 에이전트 | 기본 모델 | 백업 모델 | 이유 |
|---|---|---|---|
| EWS 모니터 | `gpt-4o-mini` | `gemini-2.0-flash` | 단순 데이터 스캔, 고비용 불필요 |
| AI 튜터 | `claude-haiku-3-5` | `gpt-4o-mini` | 자연스러운 대화, 속도·비용 균형 |
| AI 강사 | `claude-haiku-3-5` | `gpt-4o-mini` | 커리큘럼 기반 코드 리뷰 |
| 포트폴리오 심사 | `gpt-4o` | `claude-sonnet-4-5` | 복잡한 유사도 분석, 추론력 필요 |
| 멘탈케어 | `claude-haiku-3-5` | `gpt-4o-mini` | 공감적 어조, 감성 표현 |

**작업 항목**:
- [x] LLM 어댑터 팩토리 함수 구현 (모델명으로 어댑터 인스턴스 반환)
- [x] `fallbackAdapterConfig` 자동 전환 로직 구현
- [x] 토큰 사용량 + 비용 계산 미들웨어 (`cost_events` 기록)

---

### 3-4. 강사 대시보드 UI — 스킬 관리 (Phase 3 범위)

**작업 항목**:
- [ ] 스킬 파일 관리 페이지 구현
  - 스킬 목록 CRUD
  - Split-pane 마크다운 에디터 (`@uiw/react-md-editor`)
  - 서식 툴바 (굵게 / 기울임 / 목록 / 코드블록 / 표 삽입)
  - "저장하고 AI 강사에 즉시 반영" 버튼
  - 버전 이력 표시 (언제 누가 수정했는지)
- [ ] 에이전트 등록·설정 폼 구현
  - 이름 / 역할 선택 / 모델 선택 (추천 표시 포함) / 월 예산 / 적용 스킬 / 백업 모델
  - JSON 입력 필드 없음, 전부 드롭다운·토글·숫자 입력

---

### Phase 3 완료 기준 (Definition of Done)

- [ ] 강사가 GUI에서 스킬 파일 작성 → 저장 즉시 AI 강사 응답에 컨벤션 반영 확인
- [ ] Java반 → Python반 전환 시 스킬 파일 교체만으로 AI 전문성 전환 확인
- [ ] LLM API 장애 시 백업 벤더로 자동 전환 동작 확인
- [ ] 에이전트 등록을 GUI에서 JSON 없이 완료 가능

---

## Phase 4 — 포트폴리오 차별화 시스템 (기능 4)

> **목표**: 다중 에이전트 협업으로 수강생마다 독창적인 포트폴리오 기획서를 도출한다.  
> **기간**: 7~9개월차

---

### 4-1. 다중 에이전트 오케스트레이션 워크플로우

```
1단계 (페르소나 인터뷰)
[고객 페르소나 에이전트] ←→ [수강생]
 └ 특정 산업군 고객 역할로 요구사항 도출 인터뷰 시뮬레이션

2단계 (기획서 작성)
[기획 평가 에이전트]
 └ 요구사항 명세서 작성, 기술 스택 제안

3단계 (보안 검토)
[보안 전문가 에이전트]
 └ OWASP 기준 보안 취약점 지적

4단계 (유사도 판별)
[유사도 판별 에이전트]
 └ 역대 수료생 프로젝트 벡터 DB 비교 → 차별화 피드백
```

**작업 항목**:
- [x] Goal 공유 기반 다중 에이전트 협업 플로우 구현 (`goals` 테이블 활용)
- [x] 페르소나 에이전트 System Prompt 템플릿 (산업군별 10개 이상)
- [x] 에이전트 간 메시지 전달 프로토콜 구현
- [x] 무한 루프 방지 (최대 반복 횟수 제한, 타임아웃 설정)

---

### 4-2. 포트폴리오 유사도 분석 엔진

```
[수강생 기획서 제출]
        ↓
[기획서 텍스트 임베딩 생성]
        ↓
[portfolio_similarity_logs에 비교 이력 저장]
        ↓
[유사도 85% 이상] → "차별화 필수" + 구체적 차별화 요소 3가지 제안
[유사도 60~85%]  → "개선 권장" + 부분 차별화 방향 제시
[유사도 60% 미만] → "독창성 충족" 인증 + 다음 단계 진행 허가
```

**작업 항목**:
- [x] `portfolio_projects` 테이블 임베딩 컬럼 추가 (pgvector)
- [x] 수료생 기존 프로젝트 벡터 DB 구축 (초기 시드 데이터)
- [x] 유사도 분석 API 구현 (`POST /portfolio/analyze`)
- [x] 차별화 제안 프롬프트 작성 (소크라테스식 vs 직접 제안 선택 가능)

---

### 4-3. 수강생 포털 UI — 포트폴리오 섹션 (Phase 4 범위)

**작업 항목**:
- [x] 포트폴리오 기획서 작성 에디터 UI (`ProposalEditor.tsx`)
- [x] 독창성 점수 게이지 바 (실시간 업데이트) (`OriginalityGauge.tsx`)
- [x] 다중 에이전트 인터뷰 채팅 UI (페르소나별 아바타 표시) (`InterviewChat.tsx`)
- [x] 단계별 진행 상황 트래커 (인터뷰 → 기획서 → 보안검토 → 독창성 인증) (`StageTracker.tsx`)
- [x] 메인 포트폴리오 워크플로우 페이지 (`PortfolioPage.tsx`, `/portfolio` 라우트)
- [x] 관리자 GUI — 포트폴리오 설정 페이지 (`PortfolioSettings.tsx`)
  - 유사도 기준 슬라이더 (critical 85% / warning 60%)
  - 피드백 스타일 선택 (소크라테스식 / 직접 제안)
  - 비교 대상 선택 (현 기수 / 역대 수료생)

---

### Phase 4 완료 기준 (Definition of Done)

- [x] 수강생이 인터뷰 → 기획서 → 피드백 → 독창성 인증까지 포털에서 완료 가능
- [x] 유사도 85% 이상 기획서에 자동 차별화 피드백 수신 확인
- [x] 관리자가 GUI에서 유사도 기준 슬라이더 조정 → 즉시 반영 확인

---

## Phase 5 — 고도화 및 다기관 확산

> **목표**: 시스템 안정성을 높이고 복수의 교육기관에 확산 가능한 구조로 전환한다.  
> **기간**: 10개월차~

---

### 5-1. RAG 파이프라인 분리 (Gemini 제언 반영)

**단계적 분리 전략**:

| 단계 | 구현 방식 | 시점 |
|---|---|---|
| 현재 (Phase 1~4) | `worker_threads`로 메인 서버 내 비동기 처리 | 이미 적용 |
| Phase 5-A | `packages/rag-worker/` 별도 프로세스 + Bull Queue(Redis) | 수강생 50명 초과 시 |
| Phase 5-B | Serverless Function(AWS Lambda / Cloudflare Workers) 전환 | 다기관 확산 시 |

**작업 항목**:
- [ ] Redis + Bull Queue 기반 임베딩 작업 큐 구현
- [ ] `packages/rag-worker/` 독립 서비스로 분리
- [ ] `docker-compose.yml`에 `rag-worker` + `redis` 서비스 추가

---

### 5-2. 멀티 테넌시 (Multi-Tenancy) 지원

**작업 항목**:
- [ ] `institutions` 테이블 기반 테넌트별 데이터 완전 분리 확인
- [ ] Row-Level Security (RLS) PostgreSQL 정책 적용
- [ ] 테넌트별 독립 예산·에이전트·스킬 파일 관리 확인
- [ ] 슈퍼관리자(Super Admin) 역할 추가 (여러 교육기관 통합 관리)

---

### 5-3. 온보딩 가이드 내장

신규 교육기관 도입 시 강사가 처음 접속하면 단계별 투어 자동 실행.

```
1단계: "첫 번째 스킬 파일을 만들어 보세요" → 예시 템플릿 자동 삽입
2단계: "AI 강사를 현재 과목에 연결하세요" → 드롭다운으로 연결
3단계: "수강생이 질문을 남기면 이렇게 보입니다" → 데모 미리보기
```

**작업 항목**:
- [ ] `react-joyride` 또는 `driver.js` 기반 투어 UI 구현
- [ ] 역할별 온보딩 시나리오 작성 (원장 / 강사 / 수강생)
- [ ] 온보딩 완료 여부 DB 저장 (완료 후 재표시 안 함)

---

### 5-4. 시스템 상태 모니터링 UI

**작업 항목**:
- [ ] 서비스 상태 대시보드 구현 (API 서버 / DB / AI 스케줄러 / 외부 연동)
- [ ] 에이전트별 실행 상태 실시간 표시 (WebSocket)
- [ ] "서비스 재시작" 버튼 구현 (Docker API 연동 또는 pm2 명령)
- [ ] 오류 발생 시 "[로그 보기]" 버튼 → `heartbeat_runs.stdoutExcerpt` 표시

---

### 5-5. 보안 감사 및 컴플라이언스

**작업 항목**:
- [ ] 개인정보 익명화 처리 확인 (수강생 실명 ↔ 익명 ID 분리)
- [ ] PostgreSQL 컬럼 레벨 암호화 적용 (민감 데이터)
- [ ] 수료 후 5년 데이터 자동 삭제 스케줄 구현 (교육부 지침 준수)
- [ ] RBAC 전체 엔드포인트 접근 권한 최종 검토
- [ ] 보안 취약점 점검 (OWASP Top 10 기준)
- [ ] 정기 보안 감사 체계 수립

---

## 부록 A. GUI 설정 구현 체크리스트

> **원칙**: 원장·강사·운영 담당자는 터미널, `.env` 파일, SQL, `docker compose` 명령어를 사용하지 않고 웹 브라우저만으로 전체 시스템을 운영할 수 있어야 한다.

| GUI 기능 | 대응 API | 구현 Phase | 상태 |
|---|---|---|---|
| 에이전트 등록·설정 폼 | `POST/PUT /admin/agents` | Phase 3 | - |
| 시각적 스케줄 설정기 | `PUT /admin/routines` | Phase 2 | - |
| 스킬 파일 마크다운 에디터 | `PUT /admin/skills` | Phase 3 | - |
| MCP 외부 시스템 연동 폼 | `POST /admin/connectors` | Phase 1 | - |
| EWS 임계치 슬라이더 | `PUT /admin/thresholds` | Phase 2 | - |
| 예산 숫자 입력 + 게이지 | `PUT /admin/budget` | Phase 2 | - |
| 포트폴리오 유사도 슬라이더 | `PUT /admin/portfolio-settings` | Phase 4 | 완료 |
| API 키 마스킹 보안 키 관리 | `PUT /admin/secrets` | Phase 1 | - |
| 사용자 초대·엑셀 업로드 | `POST /admin/users/invite` | Phase 2 | - |
| 교재 드래그앤드롭 업로드 | `POST /admin/documents` | Phase 1 | - |
| LLM 모델 드롭다운 선택 | `PUT /admin/agents/:id` | Phase 3 | - |
| 서비스 재시작 버튼 | `POST /admin/system/restart` | Phase 5 | - |

---

## 부록 B. 보안 설계 요약

| 항목 | 적용 방안 | 구현 Phase |
|---|---|---|
| 데이터 최소 수집 | 수강생 익명 ID 사용, 실명 분리 저장 | Phase 1 |
| RBAC 접근 제어 | `/student/*`, `/instructor/*`, `/admin/*` 라우트 분리 | Phase 0 |
| API 키 보안 저장 | 암호화 저장, 화면 마스킹, 코드베이스 하드코딩 금지 | Phase 1 |
| 에이전트 인증 | 단기 JWT (실행 시에만 유효), 장기 키 미노출 | Phase 2 |
| MCP 권한 제한 | Read-only 기본, Write는 Slack 알림 채널만 허용 | Phase 1 |
| 감사 로그 | 에이전트 외부 접근 이력 전체 기록 | Phase 1 |
| 데이터 보존 | 수료 후 5년 자동 삭제 스케줄 | Phase 5 |
| Webhook 보안 | GitHub Webhook HMAC-SHA256 서명 검증 | Phase 2 |

---

## 부록 C. KPI 목표

| KPI | 현재 | 목표 | 측정 기준 |
|---|---|---|---|
| 중도 탈락률 | 평균 20% | 12% 이하 | Phase 2 도입 후 3개월 추적 |
| 강사 반복 질문 응대 | 일 평균 30건 | 10건 이하 | AI 튜터 처리율 모니터링 |
| 수강생 만족도 | 3.8 / 5.0 | 4.5 / 5.0 이상 | 종강 후 설문 |
| 수료 후 6개월 취업률 | 55% | 70% 이상 | 수료생 사후 추적 조사 |
| 포트폴리오 독창성 달성률 | 기준치 없음 | 90% (유사도 60% 미만) | 유사도 판별 시스템 자동 집계 |
| 월 AI API 비용 | 상시 가동 100% | Heartbeat 방식 35% | 비용 모니터링 대시보드 |

---

## 부록 D. 기술 의존성 목록

```jsonc
// 핵심 의존성
{
  "node": ">=20.0.0",
  "pnpm": ">=9.0.0",
  "docker": ">=24.0.0",
  "docker-compose": ">=2.0.0",

  // 서버
  "express": "^4.18",
  "drizzle-orm": "^0.30",
  "postgres": "^3.4",          // postgres.js (paperclip 차용)
  "drizzle-kit": "^0.20",
  "socket.io": "^4.7",
  "jsonwebtoken": "^9.0",
  "zod": "^3.22",

  // AI / LLM
  "openai": "^4.0",
  "anthropic": "^0.24",
  "@google/generative-ai": "^0.14",

  // RAG
  "pdf-parse": "^1.1",         // PDF 파싱
  // pgvector는 PostgreSQL 확장으로 별도 설치

  // 프론트엔드
  "react": "^18.0",
  "tailwindcss": "^3.4",
  "@uiw/react-md-editor": "^3.23",  // 스킬 파일 마크다운 에디터
  "react-dropzone": "^14.2",         // 교재 파일 업로드
  "react-hook-form": "^7.51",
  "socket.io-client": "^4.7"
}
```

---

## 부록 E. AI 검토 의견 (Gemini 3.1 Pro)

### 구축 계획서 전반적 평가
본 구축 계획서(`plan.md`)는 매우 현실적이고 실행 가능한(Actionable) 엔지니어링 로드맵입니다. 특히 오픈소스(`paperclip`)의 부분 차용 전략과 비개발자 친화적인 GUI 전환 전략이 Phase별로 적절히 안배되어 있어 프로젝트의 성공 가능성이 높습니다.

### 로드맵의 주요 강점

1. **영리한 Phase 1 MVP 선정**: 가장 복잡도 높은 스케줄러나 다중 에이전트 협업보다 수강생이 즉시 가치를 체험할 수 있는 기능 3(AI 튜터)을 Phase 1에 배치한 것은 탁월한 전략입니다. 이는 학원 현장에서 프로젝트 도입의 명분을 초기에 빠르게 확보해 줍니다.
2. **GUI 중심의 점진적 전환**: CLI나 설정 파일에 의존하지 않는 "코드 없는 운영(Code-free Operation)" 원칙이 각 Phase의 Front-end 작업 항목에 명확히 반영되어 있습니다. 부록 A(GUI 설정 기능 리스트)를 통해 상태 추적이 용이해진 점이 인상적입니다.
3. **실용적인 아키텍처 스케일링**: RAG 임베딩 및 다중 에이전트 워크플로우를 초기(Phase 1~4)에는 단일 서버 내 `worker_threads`로 해결하고 궤도에 오른 후(Phase 5) 분리형 워커 노드와 Redis Queue로 전환하는 설계는 스타트업 및 신규 사업 체제에서 오버엔지니어링을 피하는 모범적인 접근입니다.

### 위험 관리 및 추가 제언 (Next Step)

1. **E2E(End-to-End) 테스트 항목 명시**: 에이전트가 개입하는 EWS 알림(Phase 2)이나 포트폴리오 협업(Phase 4)은 단위 테스트만으로 검증이 어렵습니다. Playwright나 Cypress를 활용한 시나리오 기반 통합 테스트 작성 항목을 Phase 1 후반부에 명시적으로 추가하여 품질을 조기 확보하기를 권장합니다.
2. **비용 한도 경고(Soft Limit) 설정**: Phase 2의 예산 관리에 한도 100% 도과 시 자동 일시정지 외에도 예산 80% 도달 시점에 선제적 "경고 알림(Soft Alert)"을 원장에게 발송하는 단계를 추가하면 비용 거버넌스가 더욱 탄탄해집니다.
3. **스키마 마이그레이션 병목 주의**: `paperclip`에서 차용한 스키마에 `institutionId`, `courseId` 등의 멀티 테넌트 구분을 추가하는 Phase 0 작업이 예상보다 난이도가 높을 수 있습니다. TypeScript 타입 완결성과 시딩(Seeding) 스크립트 작성에 충분한 QA 기간을 배정하시기 바랍니다.

**최종 결론**:
실제 상용 B2B 에듀테크 서비스 구축을 위한 청사진으로서 기술적 완성도가 매우 높습니다. 기획서(`project.md`)의 기능적 비전을 구체적 기술 스택과 DoD(완료 기준)로 완벽히 정제해 냈습니다. 이 계획서에 따라 개발이 진행된다면 시장에서 압도적인 운영 경쟁력을 확보할 것입니다.

---

## 부록 F. Phase 2 완료 후 개선 반영 이력 (2026-04-07)

> Phase 2 DoD 검증 완료 후 Gemini 제언 3가지를 즉시 반영하였습니다.

### F-1. EWS 임계치 DB 영속성 확보 ✅

| 항목 | 내용 |
|---|---|
| **문제** | `ews-thresholds.ts`의 `Map` 기반 인메모리 저장소는 서버 재시작 시 기본값(60/75/90)으로 리셋됨 |
| **해결** | `packages/db/src/schema/ews_settings.ts` 신규 추가 (기관당 1행 `unique` 제약) |
| **구현** | Write-Through 캐시 + DB UPSERT (`onConflictDoUpdate`) 패턴 적용 |
| **서버 기동** | `loadEwsThresholdsFromDb()` 프리워밍 → 전체 기관 임계치를 캐시에 적재 |
| **안전성** | DB 접근 실패 시 기본값(60/75/90) 폴백으로 서버 기동 중단 없이 동작 |
| **하위 호환** | 기존 단위 테스트 48개 전원 통과 (`_resetForTest()`로 DB 의존 격리) |

**신규 파일**: `packages/db/src/schema/ews_settings.ts`  
**수정 파일**: `server/src/services/ews-thresholds.ts`, `server/src/routes/admin.ts`, `server/src/index.ts`

---

### F-2. E2E 임계치-EWS 연동 시나리오 추가 ✅

| 항목 | 내용 |
|---|---|
| **요청** | Playwright 기반 E2E 파이프라인에 "임계치 슬라이더 변경 → EWS 위험 수강생 재분류" 시나리오 추가 |
| **접근** | 실 서버 없이 Playwright `route()` API 모킹 방식으로 결정 (CI 안정성 우선) |
| **검증 포인트** | ① 임계치 페이지 로딩 + 현재값 확인, ② 저장 시 PUT 요청 발생 + 성공 토스트, ③ 저장 후 EWS 대시보드 새 수강생 포함 확인, ④ 요청 스키마 필드명 검증 |

**신규 파일**: `tests/e2e/scenario-3-ews-threshold.spec.ts`

---

### F-3. Phase 3 진입 (next) 🔜

Phase 2 인프라(EWS 임계치 영속화, 테스트 커버리지 48개) 위에서 Phase 3 — Runtime Skill Injection AI 강사 작업을 시작합니다.

**Phase 3 첫 번째 작업 대상**:
1. `server/src/services/skill-prompt.ts` — 스킬 markdown + RAG 컨텍스트 결합 `buildSystemPrompt()` 함수
2. `GET/POST/PUT/DELETE /admin/skills` — `instructor_skills` 테이블 CRUD API
3. Plan 3-1의 `[Phase 2 연계]` 항목: `ews_settings` DB 프리워밍 통합 테스트

github api
---

## 부록 G. Phase 3 완료 후 개선 반영 이력 (2026-04-08)

> Phase 3-2 / 3-3 구현 완료 후 시스템 안정성 및 무결성을 위해 Gemini 제언 3가지를 반영하였습니다.

### G-1. 에이전트 계층 순환 참조 방지 ✅
- **문제**: A -> B, B -> A 형태로 `reportsTo` 무한 참조 시 다중 오케스트레이터 무한 루프 발생 우려
- **해결**: `PUT/POST /admin/agents` API에서 트리 순회(DFS) 기반 순환 참조 감지(`checkCircularDependency`) 적용

### G-2. LLM 서킷 브레이커 & 장애 알림 적용 ✅
- **문제**: 주 모델 다운 시 매 요청마다 타임아웃 지연 발생 후 백업으로 폴백됨
- **해결**: 5회 연속 실패 시 5분간 주 모델 우회(Circuit Breaker 구현). 연속 실패 경고를 Slack 웹훅으로 전송 (`/admin/secrets` 연동)

### G-3. 에이전트 변경 감사 로그(Audit) 연동 ✅
- **문제**: 에이전트 시스템 프롬프트 및 예산이 강사/관리자에 의해 임의 수정 시 추적 불가
- **해결**: 에이전트 생성/수정/삭제 시 `audit_logs` 테이블에 변경 전/후의 JSON 상태(`oldValue`, `newValue`)를 영속 기록

---

## 부록 H. Phase 4-1 완료 후 개선 반영 이력 (2026-04-08)

> Phase 4-1 다중 에이전트 오케스트레이션 구현 완료 후 운영 안정성·확장성을 위해 개선 3가지를 반영하였습니다.

### H-1. 페르소나 템플릿 DB 영속화 (Dynamic Persona Management) ✅
- **문제**: `persona-prompts.ts`에 산업군 페르소나가 하드코딩되어 있어 플랫폼 확장 시 코드 수정 필요
- **해결**:
  - `packages/db/src/schema/persona_templates.ts` 신규 추가 — `institutionId: null` 전역 기본, `institutionId: UUID` 기관 커스텀 이중 구조
  - `server/src/services/persona-service.ts` — `listPersonas()`, `getPersonaById()`, `createPersona()`, `deletePersona()`, `seedPersonaTemplates()` 구현
  - `legacyKey` 필드로 기존 `persona-prompts.ts` ID 하위 호환 보장
  - REST API: `GET/POST/DELETE /portfolio/personas` (관리자·강사 GUI 연동 준비)

**신규 파일**: `packages/db/src/schema/persona_templates.ts`, `server/src/services/persona-service.ts`

---

### H-2. Stale Session 자동 정리 스케줄러 ✅
- **문제**: 수강생이 인터뷰 중 이탈하면 `goals` 상태가 영구적으로 `in-progress`로 남아 데이터 오염
- **해결**:
  - `server/src/services/portfolio-stale-cleaner.ts` — `cleanStalePortfolioSessions()` 구현
  - 24시간 미갱신 Goals(상태 `active`, `awaitingUserInput=true`)를 `abandoned`로 전환
  - Phase 2 Heartbeat 스케줄러 `routines` 테이블에 `0 3 * * *` (매일 새벽 3시) 시드 등록
  - Slack 알림: 수강생에게 "미완료 포트폴리오 세션" 리마인드 메시지 발송 (`sendSystemAlert` 연동)
  - 처리 결과: `{ scanned, abandoned, notified, errors[] }` 반환 — 전체 항목 실패 시에도 다음 항목 계속 처리

**신규 파일**: `server/src/services/portfolio-stale-cleaner.ts`

---

### H-3. Human-in-the-Loop (HITL) 강사 개입 지점 추가 ✅
- **문제**: 기획서 완성 후 보안 검토·유사도 판별이 완전 자동 진행되어 강사 개입 불가
- **해결**:
  - `PortfolioStage`에 `hitl_review` 상태 추가 (FSM: `planning → hitl_review → security_review`)
  - `startPortfolioWorkflow({ hitlEnabled: true })` 옵션으로 기관별 HITL 활성화 선택
  - `processHitlReview({ approved, feedback })` — 승인 시 `security_review`로 전환, 거부 시 `planning`으로 복귀 + 피드백 기록
  - REST API: `POST /portfolio/:goalId/hitl-review` (강사 전용, RBAC `instructor` 역할 제한)
  - `WorkflowState.awaitingInstructorReview` 필드 추가 — 프론트엔드 UI 분기용

**수정 파일**: `server/src/services/portfolio-orchestrator.ts`, `server/src/routes/portfolio.ts`

---

**테스트 현황**: 145개 전체 통과 (Phase 4-1 개선 신규 18개 포함)

---

## 부록 I. Phase 4-3 완료 후 개선 반영 이력

### I-1. 세션 복구 로직 (Session Resumption) ✅
- `getActiveWorkflow(studentId)` 오케스트레이터 함수 추가  
  - `portfolioProjects` 최근 비완료 세션 조회 (`status NOT IN ('approved','abandoned')`)  
  - `goals.sharedContext->>'projectId'` JSON 경로로 학습목표 매칭  
- `GET /portfolio/active` REST 엔드포인트 추가 → 404 or `WorkflowState`  
- `PortfolioPage` 마운트 시 자동 복구: `stageToPhase()` 헬퍼로 FSM stage → UI 단계 매핑  
- 복구 중 "이전 세션을 복구하는 중…" 로딩 화면 표시

### I-2. 기획서 자동 저장 (Auto-save Draft) ✅
- `saveDraft(goalId, proposalText)` 오케스트레이터 함수 추가  
  - `portfolioProjects.proposalText` + `goals.sharedContext.proposalDraft` 동시 업데이트  
- `PUT /portfolio/:goalId/draft` REST 엔드포인트 추가 (`draftSchema` Zod 검증)  
- `PortfolioPage` `useEffect`: `proposalText` 변경 시 `localStorage` 즉시 저장 + 3초 디바운스 후 서버 동기화  
- `draftSaveStatus` ('idle'|'saving'|'saved') UI 피드백 표시

### I-3. SSE 스트리밍 인터뷰 UX ✅
- `POST /portfolio/:goalId/message/stream` SSE 엔드포인트 추가  
  - `text/event-stream` 헤더, 단어 단위 30–70 ms 지연 청크 스트리밍  
  - `{ type:'chunk', text }` + `{ type:'done', state }` 이벤트 구조  
- `InterviewChat.tsx`: `streamingContent?: string` prop 추가 → 실시간 타이핑 말풍선 + `animate-pulse` 커서  
- `PortfolioPage.handleSendMessage`: `fetch` + `ReadableStream` + `TextDecoder` SSE 클라이언트로 전환

**테스트 현황**: 161개 전체 통과 (UI TypeScript 컴파일 오류 0개)
