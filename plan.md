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
- [x] 스킬 파일 관리 페이지 구현
  - 스킬 목록 CRUD
  - Split-pane 마크다운 에디터 (`@uiw/react-md-editor`)
  - 서식 툴바 (굵게 / 기울임 / 목록 / 코드블록 / 표 삽입)
  - "저장하고 AI 강사에 즉시 반영" 버튼
  - 버전 이력 표시 (언제 누가 수정했는지)
- [x] 에이전트 등록·설정 폼 구현
  - 이름 / 역할 선택 / 모델 선택 (추천 표시 포함) / 월 예산 / 적용 스킬 / 백업 모델
  - JSON 입력 필드 없음, 전부 드롭다운·토글·숫자 입력

---

### Phase 3 완료 기준 (Definition of Done)

- [x] 강사가 GUI에서 스킬 파일 작성 → 저장 즉시 AI 강사 응답에 컨벤션 반영 확인
- [x] Java반 → Python반 전환 시 스킬 파일 교체만으로 AI 전문성 전환 확인
- [x] LLM API 장애 시 백업 벤더로 자동 전환 동작 확인
- [x] 에이전트 등록을 GUI에서 JSON 없이 완료 가능

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
- [x] Redis + Bull Queue 기반 임베딩 작업 큐 구현
- [x] `packages/rag-worker/` 독립 서비스로 분리
- [x] `docker-compose.yml`에 `rag-worker` + `redis` 서비스 추가
- [x] **[개선①]** DLQ + `@bull-board/express` 큐 모니터링 Admin 대시보드 (`GET /admin/queues`)
- [x] **[개선②]** `rag-worker` HTTP 헬스 서버 (`:3001/health`) + Docker 헬스체크 + 수평 확장 문서화 (`--scale rag-worker=3`)
- [x] **[개선③]** `job.updateProgress()` + BullMQ `QueueEvents` + socket.io `rag:progress` 임베딩 진행률 실시간 Admin Push

---

### 5-2. 멀티 테넌시 (Multi-Tenancy) 지원

**작업 항목**:
- [x] `institutions` 테이블 기반 테넌트별 데이터 완전 분리 확인
- [x] Row-Level Security (RLS) PostgreSQL 정책 적용
- [x] 테넌트별 독립 예산·에이전트·스킬 파일 관리 확인
- [x] 슈퍼관리자(Super Admin) 역할 추가 (여러 교육기관 통합 관리)

---

### 5-3. 온보딩 가이드 내장

신규 교육기관 도입 시 강사가 처음 접속하면 단계별 투어 자동 실행.

```
1단계: "첫 번째 스킬 파일을 만들어 보세요" → 예시 템플릿 자동 삽입
2단계: "AI 강사를 현재 과목에 연결하세요" → 드롭다운으로 연결
3단계: "수강생이 질문을 남기면 이렇게 보입니다" → 데모 미리보기
```

**작업 항목**:
- [x] `react-joyride` 또는 `driver.js` 기반 투어 UI 구현
- [x] 역할별 온보딩 시나리오 작성 (원장 / 강사 / 수강생)
- [x] 온보딩 완료 여부 DB 저장 (완료 후 재표시 안 함)

---

### 5-4. 시스템 상태 모니터링 UI

**작업 항목**:
- [x] 서비스 상태 대시보드 구현 (API 서버 / DB / Redis / AI 스케줄러)
- [x] 에이전트별 실행 상태 실시간 표시 (WebSocket `agent:status_change`)
- [x] "서비스 재시작" 버튼 구현 (SIGTERM self-send → Docker restart: unless-stopped 정책 활용)
- [x] 오류 발생 시 "[로그 보기]" 버튼 → `heartbeat_runs.stdoutExcerpt` 모달 표시

---

### 5-5. 보안 감사 및 컴플라이언스

**작업 항목**:
- [x] 개인정보 익명화 처리 확인 (수강생 실명 ↔ 익명 ID 분리)
  - `anonymization-service.ts`: `anonymizeDisplayName(name)` 마스킹, `redactStudentForAi(student)` PII 제거
  - `auditPiiExposure(institutionId)`: 기관별 PII 노출 위험 지표 집계
- [x] PostgreSQL 컬럼 레벨 암호화 적용 (민감 데이터)
  - `secrets-encryption.ts`: pgcrypto `pgp_sym_encrypt/decrypt` 래퍼
  - `EncryptedEnvelope { _enc, v, data }` 봉투 패턴 + `safeDecryptIfNeeded` 레거시 호환
  - `SECRETS_ENCRYPTION_KEY` 환경변수 Fail-Fast 적용
- [x] 수료 후 5년 데이터 자동 삭제 스케줄 구현 (교육부 지침 준수)
  - `data-retention.ts`: `runDataRetention()` — 5년 경과 soft-deleted 수강생 PII 영구 삭제
  - Heartbeat 역할 `data_retention` 케이스 등록 (cron: `0 3 1 1 *`)
  - `agentRoleEnum`에 `data_retention` 추가 (DB 스키마 마이그레이션 필요)
  - DRY_RUN 모드: `NODE_ENV=test` 또는 `DATA_RETENTION_DRY_RUN=true`
- [x] RBAC 전체 엔드포인트 접근 권한 최종 검토
  - `/onboarding/*`: `authenticate` + `requireRole('student','instructor','admin','super_admin')` 추가
  - 투어별 역할 세분화: `admin-tour`→admin/super_admin, `ews-tour`→instructor 이상
  - `/admin/security/rbac-report`: 전체 엔드포인트 역할 매핑 리포트 API
- [x] 보안 취약점 점검 (OWASP Top 10 기준)
  - A05 대응 — `security-headers.ts` 미들웨어: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, `CSP`, `HSTS(production)`, `X-Powered-By` 제거
  - `server/src/index.ts`: `app.use(securityHeaders)` — 모든 라우트 앞에 마운트
- [x] 정기 보안 감사 체계 수립
  - `/admin/security/audit-report`: 감사 로그 집계 + PII 노출 지표 통합 리포트
  - `/admin/security/rbac-report`: RBAC 컴플라이언스 검증 리포트
  - 36개 신규 테스트 (429개 전체 통과)

---

## 부록 A. GUI 설정 구현 체크리스트

> **원칙**: 원장·강사·운영 담당자는 터미널, `.env` 파일, SQL, `docker compose` 명령어를 사용하지 않고 웹 브라우저만으로 전체 시스템을 운영할 수 있어야 한다.

| GUI 기능 | 대응 API | 구현 Phase | 상태 |
|---|---|---|---|
| 에이전트 등록·설정 폼 | `POST/PUT /admin/agents` | Phase 3 | 완료 |
| 시각적 스케줄 설정기 | `PUT /admin/routines` | Phase 2 | 완료 |
| 스킬 파일 마크다운 에디터 | `PUT /admin/skills` | Phase 3 | 완료 |
| MCP 외부 시스템 연동 폼 | `POST /admin/connectors` | Phase 1 | 완료 |
| EWS 임계치 슬라이더 | `PUT /admin/thresholds` | Phase 2 | 완료 |
| 예산 숫자 입력 + 게이지 | `PUT /admin/budget` | Phase 2 | 완료 |
| 포트폴리오 유사도 슬라이더 | `PUT /admin/portfolio-settings` | Phase 4 | 완료 |
| API 키 마스킹 보안 키 관리 | `PUT /admin/secrets` | Phase 1 | 완료 |
| 사용자 초대·엑셀 업로드 | `POST /admin/users/invite` | Phase 2 | 완료 |
| 교재 드래그앤드롭 업로드 | `POST /admin/documents` | Phase 1 | 완료 |
| LLM 모델 드롭다운 선택 | `PUT /admin/agents/:id` | Phase 3 | 완료 |
| 큐 모니터링 대시보드 | `GET /admin/queues` | Phase 5 | 완료 |
| 서비스 재시작 버튼 | `POST /admin/system/restart` | Phase 5 | 완료 |

---

## 부록 B. 보안 설계 요약

| 항목 | 적용 방안 | 구현 Phase |
|---|---|---|
| 데이터 최소 수집 | 수강생 익명 ID 사용, 실명 분리 저장 | Phase 1 |
| RBAC 접근 제어 | `/student/*`, `/instructor/*`, `/admin/*` 라우트 분리 + 온보딩 투어별 역할 세분화 | Phase 0/5 |
| API 키 보안 저장 | pgcrypto `pgp_sym_encrypt` 암호화 봉투 패턴 (Phase 5-5 완료) | Phase 1/5 |
| 에이전트 인증 | 단기 JWT (실행 시에만 유효), 장기 키 미노출 | Phase 2 |
| MCP 권한 제한 | Read-only 기본, Write는 Slack 알림 채널만 허용 | Phase 1 |
| 감사 로그 | 에이전트 외부 접근 이력 전체 기록 + `/admin/security/audit-report` 리포트 API | Phase 1/5 |
| 데이터 보존 | 수료 후 5년 자동 삭제 스케줄 (`data_retention` Heartbeat) | Phase 5 |
| OWASP 헤더 | CSP·HSTS·X-Frame·Referrer-Policy 등 7종 보안 헤더 미들웨어 | Phase 5 |
| PII 익명화 | `anonymizeDisplayName` 마스킹 + `redactStudentForAi` AI 전달 전 PII 제거 | Phase 5 |
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

### I-4. 관리자 설정 실시간 연동 (DoD 충족) ✅
- **문제**: 관리자가 저장한 유사도 기준 슬라이더 설정(`portfolioSettingsStore`)이 `admin.ts`의 로컬 메모리에만 격리되어 있어, 수강생이 `POST /portfolio/analyze` 호출 시 기본값만 적용됨 (DoD③ 미충족).
- **해결**: 
  - `portfolio-settings-store.ts` 공유 모듈 신설하여 기관별 in-memory 설정 스토어 분리.
  - `portfolio.ts` 내 `/analyze` 엔드포인트에서 `getPortfolioSettings()`를 통해 분석 실행 시점의 최신 임계치(`criticalThreshold`, `warningThreshold`), 피드백 스타일, 비교 범위를 동적으로 읽어오도록 수정.
  - 관리자 슬라이더 조작 즉시 다음 분석 요청부터 변경 사항이 완벽히 반영됨.

### J. 설정 저장소 DB 영속화 (Gemini 제언 반영) ✅

**배경**: Phase 4 완료 후 Gemini 코드 리뷰에서 두 가지 지적:
1. `portfolio-settings-store.ts`의 in-memory Map — 서버 재시작 시 슬라이더 설정 초기화
2. `admin.ts`의 `secretsStore` in-memory Map — 서버 재시작 시 API 키 소멸, 재입력 필요

**해결**:

#### J-1. `institution_settings` 테이블 신설
- `packages/db/src/schema/institution_settings.ts` 생성
- `(institutionId UUID FK, settingKey text)` UNIQUE 복합키, `settingValue jsonb`
- `settingKey = 'portfolio'` → `PortfolioSettings` JSON
- `settingKey = 'secrets'` → `{ openaiApiKey?, anthropicApiKey?, slackWebhookUrl? }` JSON
- ✅ Phase 5-5 완료: `secrets-encryption.ts` pgcrypto `pgp_sym_encrypt/decrypt` 컬럼 레벨 암호화 구현

#### J-2. `institution-settings-service.ts` Write-Through 캐시 서비스 신설
- `ews-thresholds.ts`와 동일한 패턴: in-memory Map + DB UPSERT + 서버 기동 프리워밍
- `initInstitutionSettingsDb(db)`, `getInstitutionSetting<T>()`, `setInstitutionSetting<T>()`, `loadAllInstitutionSettings()`
- DB 불가 시 기본값 폴백으로 서버 기동 보장

#### J-3. `portfolio-settings-store.ts` async DB 영속화
- `getPortfolioSettings()` / `setPortfolioSettings()` → `Promise<T>` 반환
- 내부에서 `getInstitutionSetting` / `setInstitutionSetting` 위임

#### J-4. `admin.ts` secretsStore → DB 영속화
- `const secretsStore = new Map<string, string>()` 제거
- GET `/admin/secrets`: `getSecrets(institutionId)` async 조회
- PUT `/admin/secrets`: `getSecrets` → 병합 → `setSecrets` UPSERT + `process.env` 즉시 반영

#### J-5. `server/src/index.ts` 프리워밍 + 재시작 시 secrets 복원
- 서버 기동 시 `initInstitutionSettingsDb` + `loadAllInstitutionSettings()` 호출
- DB에 저장된 secrets를 `process.env`에 재적용 (서버 재시작 후 LLM 어댑터 즉시 사용 가능)

**테스트 현황**: 161개 전체 통과 / tsc 오류 0개 (대상 파일 기준)

### K. Phase 5-1 RAG 파이프라인 BullMQ 비동기 분리 ✅

**배경**: Phase 1~4에서 RAG 임베딩은 `worker_threads`로 메인 스레드 블로킹을 방지했으나, 
API 서버 프로세스 내에서 처리되어 수강생 50명 초과 시 서버 부하 급증 우려.
Phase 5-A: BullMQ Queue + 독립 rag-worker 프로세스로 완전 분리.

#### K-1. BullMQ RAG 임베딩 큐 신설
- `server/src/queues/rag-ingest.job.ts` — Job 데이터 타입 (`institutionId, courseId, fileName, filePath, deliveryId`)
- `server/src/queues/rag-ingest.queue.ts` — BullMQ Queue 팩토리
  - REDIS_URL 없으면 null 반환 → admin.ts 직접 호출 fallback
  - attempts: 3 / backoff: exponential 5s→10s→20s (OpenAI Rate Limit 대응)
  - removeOnComplete: 200개, removeOnFail: 500개

#### K-2. POST /admin/documents 비동기 전환
- REDIS_URL 있음: BullMQ Job 추가 → 202 Accepted (즉시 응답)
- REDIS_URL 없음: 기존 직접 `ingestDocument()` → 201 Created (처리 완료 후 응답)
- `UPLOAD_TMP_DIR` env 지원 추가 (Docker 공유 볼륨 / 로컬 os.tmpdir() 모두 지원)

#### K-3. `packages/rag-worker/` 독립 패키지 신설
- BullMQ Worker 소비자 (`rag-ingest` 큐)
- `ingestDocument()` 호출 → 내부적으로 worker_threads + OpenAI 임베딩 + DB 저장
- 필수 환경변수 Fail-Fast 검증 (REDIS_URL, OPENAI_API_KEY)
- `RAG_WORKER_CONCURRENCY` env로 병렬 처리 수 조절 (기본: 2)
- 정상 종료: SIGTERM/SIGINT 수신 시 진행 중 Job 완료 대기 후 종료

#### K-4. Docker Compose 업데이트
- `rag-worker` 서비스 추가 (db + redis 헬스체크 후 기동)
- `uploads_tmp` Named Volume 신설 — api + rag-worker 컨테이너가 공유
- `api` 서비스에 `UPLOAD_TMP_DIR=/tmp/uploads` + `uploads_tmp` 볼륨 마운트 추가

**단계적 전환 전략**:
| 환경 | 동작 |
|---|---|
| REDIS_URL 없음 (로컬 개발) | 직접 `ingestDocument()` 호출 (기존 worker_threads 방식 유지) |
| REDIS_URL 있음 (Docker/운영) | BullMQ Job → rag-worker 프로세스 비동기 처리 |

**테스트 현황**: 161개 전체 통과 / tsc 오류 0개 (신규 파일 기준)

---

## 부록 L. Phase 5-1 개선 반영 이력 (2026-04-09)

> RAG 비동기 워커 시스템을 실제 상용 B2B 환경 수준으로 고도화하기 위해 Gemini 제언 3가지를 즉시 반영하였습니다.

### L-1. DLQ + Bull Board Admin 큐 모니터링 대시보드 ✅

| 항목 | 내용 |
|---|---|
| **문제** | 최대 재시도(3회) 초과 실패 Job이 큐 "failed" 상태로 쌓여도 관리자가 웹에서 확인·재처리 불가 |
| **해결** | `@bull-board/api` + `@bull-board/express` 설치 후 `/admin/queues` 경로에 UI 마운트 |
| **DLQ 보관** | `removeOnFail: { count: 500 }` 설정(기존)으로 최대 500개 실패 Job 보존 — Bull Board Failed 탭에서 클릭 한 번 Retry 가능 |
| **보안** | `authenticate + requireRole('admin')` 미들웨어로 admin 역할 전용 접근 제한 |
| **큐 등록** | `rag-ingest` + `github-webhook` 큐 모두 등록 (`readOnlyMode: false, allowRetries: true`) |

**신규 파일**: `server/src/routes/bull-board.ts`

---

### L-2. RAG Worker 수평 확장(Horizontal Scaling) 준비 ✅

| 항목 | 내용 |
|---|---|
| **문제** | rag-worker 1대로 대형 기관 동시 교재 업로드 시 처리 지연 우려 |
| **해결** | `packages/rag-worker/src/index.ts`에 Node.js 내장 `http` 모듈로 경량 헬스 서버(`:3001/health`) 추가 |
| **Docker 헬스체크** | `docker-compose.yml` rag-worker 서비스에 Node.js 기반 healthcheck 추가 (interval: 30s, start_period: 15s) |
| **수평 확장** | `docker compose up --scale rag-worker=3` — 코드 수정 없이 인스턴스 수 지정 확장 가능 (BullMQ가 자동 분산) |
| **클라우드 가이드** | docker-compose.yml 주석에 AWS ECS / GCP Cloud Run Auto-Scaling 적용 지침 문서화 |

**수정 파일**: `packages/rag-worker/src/index.ts`, `docker/docker-compose.yml`

---

### L-3. Chunking 진행률 실시간 Admin Push ✅

| 항목 | 내용 |
|---|---|
| **문제** | 수백 페이지 문서 Job 처리 시 진행률 파악 불가 — "처리 중" 상태만 표시 |
| **해결** | 3-레이어 진행률 파이프라인 구축 |
| **Layer 1** | `packages/rag/src/pipeline.ts` `IngestOptions.onProgress(current, total)` 콜백 추가 — DB 배치(50개) 저장마다 호출 |
| **Layer 2** | `packages/rag-worker/src/index.ts`: `onProgress` → `job.updateProgress({ current, total, institutionId, deliveryId, phase })` |
| **Layer 3** | `server/src/queues/rag-queue-events.ts`: BullMQ `QueueEvents` subscribe → `io.to('admin:<institutionId>').emit('rag:progress', { percent: 0~100 })` |
| **소켓 룸** | `server/src/socket/chat.handler.ts`: admin 역할 소켓 연결 시 `admin:<institutionId>` 룸 자동 입장 |

**신규 파일**: `server/src/queues/rag-queue-events.ts`  
**수정 파일**: `packages/rag/src/pipeline.ts`, `packages/rag-worker/src/index.ts`, `server/src/socket/chat.handler.ts`, `server/src/index.ts`

---

**진행률 이벤트 스키마** (프론트엔드 연동 참조):

```typescript
// socket.io 'rag:progress' 이벤트 페이로드
interface RagProgressEvent {
  jobId: string;       // BullMQ Job ID (= deliveryId)
  deliveryId: string;  // 업로드 요청 UUID
  current: number;     // 저장 완료된 청크 수
  total: number;       // 전체 청크 수
  percent: number;     // 0~100 (Math.round)
}
```

**테스트 현황**: 161개 전체 통과 / tsc 오류 0개 (신규 파일 기준)

---

## 부록 M. Phase 5-2 멀티 테넌시 구현 이력 (2026-04-09)

### M-1. `super_admin` 역할 추가 ✅

| 항목 | 내용 |
|---|---|
| **변경** | `USER_ROLES`에 `'super_admin'` 추가, `JwtPayload.institutionId = 'super'` 고정값 약속 |
| **인증** | `/auth/login` Zod `refine`: `super_admin` 역할이면 `institutionId='super'` 강제, 그 외 역할은 UUID 검증 |
| **RBAC** | `requireRole()` — 기존 방식 그대로 / `requireSameInstitution()` — `super_admin`도 전 기관 접근 허용 |
| **JWT** | `institutionId: 'super'`를 담은 토큰 발급 → RLS 정책의 `'super'` 분기로 자동 우회 |

---

### M-2. PostgreSQL Row-Level Security (RLS) ✅

| 항목 | 내용 |
|---|---|
| **마이그레이션** | `packages/db/drizzle/0009_rls_tenant_isolation.sql` |
| **적용 테이블** | `students`, `courses`, `agents`, `instructor_skills`, `budget_policies`, `rag_documents`, `ews_risk_scores`, `ews_settings`, `institution_settings`, `routines`, `goals`, `portfolio_projects`, `heartbeat_runs`, `persona_templates`, `audit_logs`, `institutions` (16개) |
| **정책 공식** | `current_setting('app.institution_id', true) = 'super'` OR `institution_id = …::uuid` |
| **특수 케이스** | `persona_templates`: `institution_id IS NULL`이면 전역 기본 템플릿 (모든 기관 공유) |
| **`institutions` 테이블** | `super_admin`만 전체 목록 조회 / 일반 `admin`은 자신의 기관만 조회 가능 |

---

### M-3. `withTenantContext` RLS 헬퍼 ✅

| 항목 | 내용 |
|---|---|
| **파일** | `packages/db/src/rls.ts` (신규), `packages/db/src/index.ts` (export 추가) |
| **핵심 패턴** | `db.transaction(tx => { SET LOCAL app.institution_id = ? → callback(tx) })` |
| **커넥션 풀 안전** | `SET LOCAL`은 현재 트랜잭션 범위에서만 유효 → 트랜잭션 종료 시 자동 초기화, 크로스 테넌트 오염 방지 |
| **Super Admin** | `institutionId='super'` 전달 시 RLS 정책의 `'super'` 분기 활성화 → 전 기관 데이터 접근 |
| **`setTenantSession`** | 단일 SELECT 경량 헬퍼 (세션 레벨, 폴백용) |

---

### M-4. Super Admin 통합 관리 API ✅

| 엔드포인트 | 설명 |
|---|---|
| `GET /super-admin/institutions` | 전체 기관 목록 (active + inactive) |
| `POST /super-admin/institutions` | 신규 기관 등록 (slug 중복 검사 포함) |
| `GET /super-admin/institutions/:id` | 특정 기관 상세 |
| `PUT /super-admin/institutions/:id` | 기관 정보 수정 |
| `PATCH /super-admin/institutions/:id/deactivate` | 기관 비활성화 (데이터 보존) |
| `GET /super-admin/stats` | 플랫폼 전체 통계 (기관수·수강생수·월 AI 비용·고위험 수강생·RAG 문서수) |
| `GET /super-admin/institutions/:id/stats` | 특정 기관 세부 현황 |

**보안**: `authenticate + requireRole('super_admin')` 이중 보호, `adminLimiter` 속도 제한

---

**테스트 현황**: 185개 전체 통과 (Phase 5-2 신규 24개 포함)

---

## 부록 N. Phase 5-2 개선 반영 이력 (2026-04-09)

> Phase 5-2 완료 후 3가지 아키텍처 피드백을 즉시 반영하였습니다.
> 225개 전체 Vitest 테스트 통과 / tsc 오류 0개.

---

### N-1. 복합 인덱스(Composite Index) 추가 ✅

| 항목 | 내용 |
|---|---|
| **문제** | RLS 정책이 모든 쿼리에 `WHERE institution_id = X`를 자동 삽입하지만, 단일 컬럼 FK 인덱스만 존재하여 RLS + 추가 필터(`created_at DESC`, `status`, `action`) 복합 조건에서 Table Full Scan 위험 |
| **해결** | 마이그레이션 `0010_rls_composite_indexes.sql` 생성 — 4개 핵심 테이블에 `CONCURRENTLY` 방식으로 복합 인덱스 추가 |
| **버그 수정** | `ews_risk_scores`에 `institution_id` 컬럼이 없는 상태에서 `0009` RLS 정책이 해당 컬럼을 직접 참조하는 불일치 수정 — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS institution_id`, 데이터 백필 UPDATE, RLS 정책 재생성 |

**추가된 인덱스 목록**:
| 테이블 | 인덱스 이름 | 컬럼 조합 | 용도 |
|---|---|---|---|
| `heartbeat_runs` | `heartbeat_runs_institution_created_idx` | `(institution_id, created_at DESC)` | 기관별 최신 실행 이력 |
| `heartbeat_runs` | `heartbeat_runs_institution_status_idx` | `(institution_id, status)` | 기관별 상태 필터 |
| `heartbeat_runs` | `heartbeat_runs_institution_active_idx` | `(institution_id, created_at DESC) WHERE status IN (...)` | 실행 중/대기 중 Job |
| `audit_logs` | `audit_logs_institution_created_idx` | `(institution_id, created_at DESC)` | 기관별 최근 감사 로그 |
| `audit_logs` | `audit_logs_institution_action_idx` | `(institution_id, action)` | 액션 유형별 필터 |
| `audit_logs` | `audit_logs_institution_actor_idx` | `(institution_id, actor_id)` | 행위자 추적 |
| `ews_risk_scores` | `ews_risk_scores_institution_score_idx` | `(institution_id, total_score DESC)` | 고위험 수강생 목록 |
| `ews_risk_scores` | `ews_risk_scores_student_calculated_idx` | `(student_id, calculated_at DESC)` | 수강생 최신 점수 |
| `students` | `students_institution_enrolled_idx` | `(institution_id, enrolled_at DESC) WHERE deleted_at IS NULL` | 기관별 등록순 목록 |
| `students` | `students_institution_course_idx` | `(institution_id, course_id) WHERE deleted_at IS NULL` | 기관+과목 필터 |

**수정 파일**: `packages/db/drizzle/0010_rls_composite_indexes.sql`, `packages/db/src/schema/ews_risk_scores.ts`, `heartbeat_runs.ts`, `audit_logs.ts`, `students.ts`

---

### N-2. ESLint 커스텀 룰 + Tenant Repository 계층 ✅

| 항목 | 내용 |
|---|---|
| **문제** | 개발자가 실수로 `withTenantContext()`로 감싸지 않고 `db`를 직접 route 파일에서 호출할 경우, `app.institution_id` 미설정으로 RLS가 빈 결과 또는 에러 반환 |
| **해결①** | `tools/eslint-rules/no-direct-db-in-routes.js` ESLint 커스텀 룰 — `routes/` 파일에서 `db` 직접 import/메서드 호출 금지, `withTenantContext()` 래퍼 내부는 허용 |
| **해결②** | `server/src/repositories/tenant-repository.ts` — 모든 DB 접근이 반드시 `withTenantContext`를 통하도록 강제하는 Repository 기반 계층 |
| **예외 처리** | `repositories/`, `services/`, `middleware/`, `__tests__/` 경로는 허용. `super-admin.ts`는 명시적 패턴으로 예외 허용 |

**추가 룰 구성** (`.eslintrc.json`):
```json
"local-rules/no-direct-db-in-routes": ["error", {
  "forbiddenSymbols": ["db"],
  "allowedPathPatterns": ["/repositories/", "/services/", "/middleware/", "/__tests__/"]
}]
```

**신규 파일**: `tools/eslint-rules/no-direct-db-in-routes.js`, `tools/eslint-rules/index.js`, `server/src/repositories/tenant-repository.ts`  
**수정 파일**: `.eslintrc.json`

---

### N-3. RLS 404/403 구조적 로깅 유틸리티 ✅

| 항목 | 내용 |
|---|---|
| **문제** | RLS 적용 시 크로스 테넌트 접근(403 의도)이 "데이터 없음(404)"으로 반환되어 운영 디버깅이 어려움 |
| **보안 원칙** | 클라이언트에게는 항상 404만 반환(B가 존재한다는 사실 자체를 숨김) — 변경 없음 |
| **해결** | `server/src/utils/tenant-assert.ts` 생성 — `assertTenantExists()`, `warnIfRlsEmpty()`, `rlsErrorHandler()` |

**동작 흐름**:
```
assertTenantExists(row, { resourceType, resourceId, institutionId, req })
  ├─ row != null  → 통과 (no-op)
  └─ row == null  → console.warn({ event: 'RLS_NOT_FOUND', resourceType, institutionId, method, path })
                    throw RlsNotFoundError (statusCode: 404, message: "{type} not found")
                    클라이언트: 404 JSON { error: "..." } (기관 ID 미포함)
```

**신규 파일**: `server/src/utils/tenant-assert.ts`  
**수정 파일**: `server/src/index.ts` (`rlsErrorHandler` 전역 에러 핸들러 앞단에 등록)

---

**테스트 현황**: **225개 전체 통과** (Phase 5-2 개선 신규 40개 포함) / tsc 오류 0개

---

## 부록 O. Phase 5-3 온보딩 가이드 구현 이력 (2026-04-09)

> Phase 5-3 DoD 3가지 항목을 모두 구현하였습니다.

### O-1. `driver.js` 기반 역할별 투어 UI ✅

| 항목 | 내용 |
|---|---|
| **라이브러리** | `driver.js` v1 (MIT License, ~35KB, React 의존성 없음) |
| **관리자/강사 투어** (`admin-tour`) | 3단계: ① 스킬 파일 탭 → ② 에이전트 설정 탭 → ③ 수강생 뷰 미리보기 버튼 |
| **수강생 투어** (`student-tour`) | 3단계: ① 채팅 입력창 → ② 메시지 목록(교재 인용) → ③ 포트폴리오 이동 버튼 |
| **투어 트리거** | 로그인 후 800ms 지연 → DOM 안정화 → 자동 실행 |
| **재시작** | 화면 우하단 🧭 플로팅 버튼으로 언제든 투어 재실행 가능 |

**신규 파일**:
- `ui/src/tours/scenarios.ts` — 역할별 투어 스텝 및 팝오버 텍스트 정의
- `ui/src/hooks/useOnboarding.ts` — 완료 상태 조회·저장 + driver.js 실행 훅
- `ui/src/components/OnboardingTour.tsx` — App.tsx에 삽입되는 투어 컨테이너

**수정 파일** (투어 타깃 `id` 속성 추가):
- `ui/src/pages/ChatPage.tsx` — `#chat-input`, `#chat-messages`, `#portfolio-nav-btn`
- `ui/src/pages/AdminPage.tsx` — `#admin-sidebar-{tab.id}`, `#admin-chat-preview-btn`
- `ui/src/App.tsx` — `<OnboardingTour />` 컴포넌트 삽입

---

### O-2. 역할별 온보딩 시나리오 ✅

| 역할 | 투어 ID | 진입 경로 | 단계 수 |
|---|---|---|---|
| admin / instructor | `admin-tour` | `/admin` | 3단계 |
| student | `student-tour` | `/chat` | 3단계 |

plan.md 5-3 시나리오 그대로 반영:
- **1단계**: 스킬 파일 탭 → "예시 템플릿 자동 삽입" 안내
- **2단계**: 에이전트 설정 → "드롭다운으로 연결" 안내
- **3단계**: 수강생 뷰 이동 → "데모 미리보기" 안내

---

### O-3. 온보딩 완료 여부 DB 영속화 ✅

| 항목 | 내용 |
|---|---|
| **테이블** | `onboarding_completions` 신설 (마이그레이션 `0011_onboarding_completions.sql`) |
| **제약** | `(user_id, tour_id) UNIQUE` — 동일 투어 중복 기록 방지 |
| **멱등성** | `onConflictDoNothing()` — 서버 재시작 / 재클릭 시에도 중복 없음 |
| **API** | `GET /onboarding/status` (완료 목록 조회) + `POST /onboarding/complete` |
| **개발 편의** | `DELETE /onboarding/reset` — production 환경에서는 403 차단 |

**신규 파일**: `packages/db/src/schema/onboarding_completions.ts`, `packages/db/drizzle/0011_onboarding_completions.sql`, `server/src/routes/onboarding.ts`

---

**테스트 현황**: **278개 전체 통과** (Phase 5-3 신규 53개 포함) / tsc 오류 0개

---

## 부록 P. Phase 5-3 개선 반영 이력 (2026-04-09)

> Gemini 제언 3가지를 Phase 5-3 온보딩 구현에 즉시 반영하였습니다.

### P-1. 투어 부분 진행 척도 (Intermediate Progress) 트래킹 ✅

| 항목 | 내용 |
|---|---|
| **문제** | 전체 투어를 완료해야만 DB에 기록 — 중간 이탈 후 재접속 시 처음부터 재시작 |
| **해결** | `onboarding_completions` 테이블에 `last_step_index integer DEFAULT -1` 추가 |
| **마이그레이션** | `0012_onboarding_progress.sql` — ALTER TABLE + completed_at NOT NULL 해제 + 진행 중 인덱스 |
| **API** | `PATCH /onboarding/progress { tourId, lastStepIndex }` 신설 — UPSERT, 완료 후 재진행 방지 |
| **프론트엔드** | `useFeatureTour` 훅의 `onHighlightStarted` 콜백에서 스텝 전환 시 서버 동기화 |
| **재개 로직** | `GET /status` 가 `progressMap` 함께 반환 → 재접속 시 `driver.drive(lastStepIndex)` |

**신규 파일**: `packages/db/drizzle/0012_onboarding_progress.sql`  
**수정 파일**: `packages/db/src/schema/onboarding_completions.ts`, `server/src/routes/onboarding.ts`

---

### P-2. 브라우저 간 상태 동기화 (Cross-Tab Sync) ✅

| 항목 | 내용 |
|---|---|
| **문제** | PC/태블릿 멀티 기기에서 한 쪽 투어 완료 시 다른 탭에 재팝업 발생 |
| **해결** | WebSocket은 이미 Phase 1에 구현됨 → `user:{userId}` 개인 룸 join 추가 후 완료 이벤트 emit |
| **서버** | `chat.handler.ts` — 연결 즉시 `socket.join('user:{userId}')` 추가 |
| **서버** | `onboarding.ts` — POST /complete 성공 시 `io?.to('user:{userId}').emit('onboarding:completed', { tourId })` |
| **프론트엔드** | `useChat.ts` — `getSharedSocket(token)` export 신설 |
| **프론트엔드** | `useFeatureTour.ts` — `socket.on('onboarding:completed')` 수신 시 `driver.destroy()` 호출 |

**수정 파일**: `server/src/socket/chat.handler.ts`, `server/src/routes/onboarding.ts`, `ui/src/hooks/useChat.ts`, `ui/src/hooks/useFeatureTour.ts`

---

### P-3. 기능별 분리 투어 (Feature-based Tours) ✅

| 항목 | 내용 |
|---|---|
| **문제** | 모든 기능이 단일 `admin-tour`에 통합 — 도메인별 맥락 없는 안내 |
| **해결** | `useFeatureTour(tourId, triggerCondition)` 범용 훅 신설 (`useOnboarding`을 thin wrapper로 리팩터) |
| **신규 투어** | `portfolio-tour` — `/portfolio` 최초 방문 시 수강생에게 3단계 포트폴리오 워크플로우 안내 |
| **신규 투어** | `ews-tour` — `/admin` 최초 방문 시 관리자/강사에게 EWS 대시보드·임계치·스케줄 3단계 안내 |
| **DOM ID 추가** | `PortfolioPage.tsx` — `#portfolio-stage-tracker`, `#portfolio-interview-chat`, `#portfolio-originality-gauge` |
| **컴포넌트** | `OnboardingTour.tsx` — 라우트별 플로팅 버튼 3개(🧭/📋/📊) + 각 tour 자동 실행 |
| **VALID_TOUR_IDS** | 서버 화이트리스트에 `'portfolio-tour'`, `'ews-tour'` 추가 |

**신규 파일**: `ui/src/hooks/useFeatureTour.ts`  
**수정 파일**: `ui/src/tours/scenarios.ts`, `ui/src/hooks/useOnboarding.ts`, `ui/src/components/OnboardingTour.tsx`, `ui/src/pages/PortfolioPage.tsx`

---

**테스트 현황**: 311개 전체 통과 (신규 33개 포함) / tsc 오류 0개

---

## 부록 M. Phase 5-4 시스템 상태 모니터링 UI 구현 이력 (2026-04-09)

### M-1. 서비스 상태 대시보드 구현 ✅

| 항목 | 내용 |
|---|---|
| **API** | `GET /admin/system/status` — API·DB·Redis·AI Scheduler 4가지 서비스 헬스 집계 반환 |
| **DB 체크** | `SELECT 1` 응답 시간 측정 → 정상/다운 판별 |
| **Redis 체크** | `REDIS_URL` 있으면 ioredis `ping()` 수행, 없으면 `unavailable` 표시 |
| **스케줄러 체크** | `getHeartbeatStatus()` 호출 → `isRunning`, `currentConcurrentRuns` 표시 |
| **응답 구조** | `{ services[], uptime, memoryMb, timestamp }` |

**신규 파일**: `server/src/services/system-status.ts`, `server/src/routes/system.ts`  
**수정 파일**: `server/src/routes/admin.ts` (systemRouter 하위 마운트 `/admin/system`)

---

### M-2. 에이전트별 실행 상태 실시간 WebSocket ✅

| 항목 | 내용 |
|---|---|
| **이벤트** | `agent:status_change` — heartbeat 완료/실패 시 `admin:<institutionId>` 룸에 emit |
| **페이로드** | `{ agentId, agentName, runId, status, finishedAt, errorMessage? }` |
| **구현 위치** | `heartbeat.ts` — completed/failed 기록 직후 `io?.to(...).emit(...)` 삽입 |
| **프론트엔드** | `SystemMonitor.tsx` — `recentEvents` state에 최근 20개 누적 + 쿼리 자동 무효화 |

**수정 파일**: `server/src/services/heartbeat.ts`

---

### M-3. UI 대시보드 (SystemMonitor.tsx) ✅

| 항목 | 내용 |
|---|---|
| **서비스 카드** | 4개 서비스 상태 카드 (ok/degraded/down/unavailable/stopped 색상 구분) |
| **에이전트 테이블** | 역할·상태·마지막 실행 시각·소요 시간 표시 + 실시간 `.animate-pulse` 인디케이터 |
| **로그 보기** | `stdoutExcerpt` 전체 내용 모달 표시 (`pre` 태그 + monospace) |
| **서비스 재시작** | 확인 다이얼로그 → `POST /admin/system/restart` → SIGTERM self-send |
| **자동 갱신** | React Query `refetchInterval: 30_000` |
| **Admin 탭** | `AdminPage.tsx` — `system` (`📊 시스템 모니터링`) 탭 추가 |

**신규 파일**: `ui/src/pages/admin/SystemMonitor.tsx`  
**수정 파일**: `ui/src/pages/AdminPage.tsx`

---

**테스트 현황**: 358개 전체 통과 (신규 47개 포함) / tsc 오류 0개 (신규 파일 기준)

---

## 부록 N. Phase 5-4 개선 반영 이력 (2026-04-09)

> Phase 5-4 완료 검증 후 보안·안정성·UX 취약점 3가지를 즉시 반영하였습니다.

### N-1. [보안] Socket.io Admin 룸 JWT 인증 강화 ✅

| 항목 | 내용 |
|---|---|
| **문제** | Socket.io `admin:*` 룸에 비관리자 클라이언트가 임의 진입하여 `agent:status_change` 이벤트 수신 가능 우려 |
| **해결 ①** | `io.of('/').adapter.on('join-room', ...)` 어댑터 레벨 가드 추가 — `admin:*` 룸 진입 시 `socket.data.role !== 'admin'` 검사 후 즉시 `socket.leave()` + 경고 로그 출력 |
| **해결 ②** | `join_session` 이벤트 핸들러에 sessionId 포맷 화이트리스트 검증 추가 — `/^[a-zA-Z0-9_-]+$/` (영숫자·하이픈·언더스코어, 1~128자) 이외 값 거부 → `admin:`, `student:` 등 보호 룸 네임스페이스 우회 시도 차단 |
| **보안 계층** | JWT 미들웨어(1차) + 어댑터 룸 가드(2차) 이중화로 토큰 위변조 방어 강화 |

**수정 파일**: `server/src/socket/chat.handler.ts`

---

### N-2. [안정성] 헬스체크 API Cascading Failure 방지 ✅

| 항목 | 내용 |
|---|---|
| **문제** | DB/Redis가 Hang 상태일 때 `/admin/system/status` 폴링 요청이 무한 대기 → Node.js 이벤트 루프·커넥션 풀 고갈 위험 |
| **해결** | `withTimeout<T>(promise, ms, fallback)` 유틸 신설 — `Promise.race([promise, timeout])` 패턴으로 지정 시간 초과 시 fallback 반환 |
| **DB 타임아웃** | `DB_HEALTH_TIMEOUT_MS = 3000` — 3초 초과 시 `{ status: 'down', detail: '응답 없음 (3000ms 타임아웃)' }` 반환 |
| **Redis 타임아웃** | `REDIS_HEALTH_TIMEOUT_MS = 2000` — 2초 초과 시 `{ status: 'down', detail: '응답 없음 (2000ms 타임아웃)' }` 반환 |
| **ioredis 최적화** | `connectTimeout: 1500`, `maxRetriesPerRequest: 0` — 타임아웃 발생 시 재시도 없이 즉시 실패 처리하여 지연 최소화 |

**수정 파일**: `server/src/services/system-status.ts`

---

### N-3. [UX/성능] 로그 뷰어 Tail-N + 키워드 검색 + 하이라이트 ✅

| 항목 | 내용 |
|---|---|
| **문제** | `stdoutExcerpt` 가 MB 단위로 커질 경우 모달 열기 시 React UI 스레드 블로킹 |
| **Tail-N 렌더링** | 기본 최근 200줄만 표시 (`LOG_CHUNK_SIZE = 200`) — 줄 번호 표시, "↑ 이전 N줄 더 보기" 버튼으로 청크 단위 추가 로드 |
| **키워드 검색** | 검색 입력 시 매칭 줄만 필터링 + 검색 결과 줄 수 표시, 검색어 변경 시 visibleCount 초기화 |
| **하이라이트** | `highlightKeyword()` 함수 — HTML 특수문자 이스케이프(XSS 방지) 후 키워드 `<mark>` 태그 감싸기, 정규식 특수문자 이스케이프 처리 |
| **전체 복사** | "📋 전체 복사" 버튼 → `navigator.clipboard.writeText(log)` (미지원 환경 무시) |

**수정 파일**: `ui/src/pages/admin/SystemMonitor.tsx`

---

**테스트 현황**: 393개 전체 통과 (Phase 5-4 개선 신규 35개 포함) / tsc 오류 0개 (수정 파일 기준)

---

## 부록 O. Phase 0-5 전체 검증 이력 (2026-04-09)

> Phase 5-5 커밋 이후 전체 코드베이스 통합 검증을 수행하여 발견된 이슈를 일괄 수정하였습니다.

### O-1. TypeScript 컴파일 오류 수정 (6개 파일)

| 파일 | 오류 유형 | 수정 내용 |
|---|---|---|
| `phase4-1-orchestration.test.ts` | TS2352 타입 불일치 | `as ReturnType<...>` → `as unknown as ReturnType<...>` |
| `phase5-2-improvements.test.ts` | TS2775 assertion 오류 | 동적 import → 정적 import 전환 |
| `phase4-2-similarity.test.ts` | mock 반환 형태 불일치 | `{ rows: [...] }` → `[...]` (postgres.js 직접 배열 반환) |
| `portfolio-orchestrator.ts` | 누락 필드 + 타입 오류 | `provider: adapter.provider` 추가, `result.rows` → `Array.from(result)` |
| `portfolio-similarity.ts` | 타입 오류 3건 | `.rows[0]` 접근 수정, `signal` 파라미터 제거, `as any` 캐스팅 |
| `system-status.ts` | TS2351 not constructable | `RedisClass as any` 패턴으로 우회 |

**결과**: tsc `--noEmit` 오류 0개

### O-2. 단위 테스트 전체 통과

- **429/429** 통과 (Duration ≈ 3s)
- `phase4-2-similarity.test.ts` 5개 실패 → mock 수정으로 해결

### O-3. Docker / DB 수정

| 항목 | 수정 내용 |
|---|---|
| `docker/init.sql` | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` 추가 (Phase 5-5 요구사항) |
| `packages/db/drizzle/0013_agent_role_data_retention.sql` | `ALTER TYPE "public"."agent_role" ADD VALUE IF NOT EXISTS 'data_retention';` 신규 생성 |
| `packages/db/drizzle/meta/_journal.json` | 15개 엔트리(0000~0013) 정합성 복원 |

### O-4. E2E 테스트 수정 (13/13 통과)

| 파일 | 수정 내용 |
|---|---|
| `ui/src/pages/AdminPage.tsx` | `useLocation()` 기반 URL → 초기 탭 동기화 (`/admin/thresholds` → `thresholds` 탭) |
| `tests/e2e/scenario-2-document-upload.spec.ts` | route mock 포트 필터 수정, `loginAs()` waitForURL 추가 |
| `tests/e2e/scenario-3-ews-threshold.spec.ts` | localStorage 키 `'authToken'` → `'educlip_token'`, mock 데이터 필드명 수정, strict mode `.first()` 추가 |

**최종 테스트 현황**: **429개 단위 테스트 + 13개 E2E 테스트 전체 통과** / tsc 오류 0개 / 5개 패키지 빌드 성공
## Phase 6 — 프로덕션 배포 및 운영 고도화 (Post-Launch)

> **목표**: 실제 운영 환경(Production)으로 시스템을 이전하고 대규모 트래픽 병목을 방지하며, 데이터 기반 의사결정 체계를 구축한다.

### 6-1. 부하 테스트 및 인프라 최적화 (Scale-out)
* **API 및 WebSocket 부하 테스트**: `k6` 또는 `Artillery`를 활용해 동시 접속 수강생 500명 이상 규모의 LLM 채팅 및 RAG 임베딩 처리 한계점 테스트 및 튜닝.
* **커넥션 풀링 다중화**: DB 부하 분산을 위한 `PgBouncer` 또는 RDS Proxy 도입 및 Redis Cluster/Sentinel 구성 검토.

### 6-2. CI/CD 및 인프라 프로비저닝 (IaC)
* **CI/CD 파이프라인**: GitHub Actions 또는 GitLab CI 빌드·캐싱·테스트 자동화 (현재 통과하는 429개 단위 테스트 및 Playwright E2E 기반 커밋/PR 보호).
* **퍼블릭 클라우드 전환**: AWS ECS/Fargate 또는 GCP Cloud Run을 활용한 Serverless Container 오케스트레이션 구성. Terraform을 이용한 코드 기반 인프라 배포 적용.

### 6-3. 텔레메트리(APM) 및 분산 추적 (Observability)
* **시스템 추적 도구 통합**: Sentry, Datadog, 또는 OpenTelemetry를 연동하여 서버 사이드 에러, 메모리 릭, API Latency 및 쿼리 병목 구간 실시간 가시화.
* **LLM 비용/토큰 최적화 대시보드**: OpenAI/Anthropic/Gemini 등 실질 API 사용률과 토큰 소비량을 모니터링하여 교육기관별 청구 모델 기준점 도출.

### 6-4. 사용자 행동 기반 기능 개선 (Data Flywheel)
* **행석 분석 툴 연동**: PostHog 또는 Mixpanel 도입을 통해 학생의 화면 체류 시간, 첫 질문까지 걸리는 시간, 포트폴리오 전환율 분석.
* **EWS (조기경보시스템) 피드백 루프**: 시스템이 식별한 '중도 탈락 위험군' 학생이 실제로 탈락하는지, 아니면 AI 개입으로 회복하는지에 대한 정확률 튜닝.

## Phase 6 — 프로덕션 배포 및 운영 고도화 (Post-Launch)

> **목표**: 실제 운영 환경(Production)으로 시스템을 이전하고 대규모 트래픽 병목을 방지하며, 데이터 기반 의사결정 체계를 구축한다.

### 6-1. 부하 테스트 및 인프라 최적화 (Scale-out)
* **API 및 WebSocket 부하 테스트**: `k6` 또는 `Artillery`를 활용해 동시 접속 수강생 500명 이상 규모의 LLM 채팅 및 RAG 임베딩 처리 한계점 테스트 및 튜닝.
* **커넥션 풀링 다중화**: DB 부하 분산을 위한 `PgBouncer` 또는 RDS Proxy 도입 및 Redis Cluster/Sentinel 구성 검토.

### 6-2. CI/CD 및 인프라 프로비저닝 (IaC)
* **CI/CD 파이프라인**: GitHub Actions 또는 GitLab CI 빌드·캐싱·테스트 자동화 (현재 통과하는 429개 단위 테스트 및 Playwright E2E 기반 커밋/PR 보호).
* **퍼블릭 클라우드 전환**: AWS ECS/Fargate 또는 GCP Cloud Run을 활용한 Serverless Container 오케스트레이션 구성. Terraform을 이용한 코드 기반 인프라 배포 적용.

### 6-3. 텔레메트리(APM) 및 분산 추적 (Observability)
* **시스템 추적 도구 통합**: Sentry, Datadog, 또는 OpenTelemetry를 연동하여 서버 사이드 에러, 메모리 릭, API Latency 및 쿼리 병목 구간 실시간 가시화.
* **LLM 비용/토큰 최적화 대시보드**: OpenAI/Anthropic/Gemini 등 실질 API 사용률과 토큰 소비량을 모니터링하여 교육기관별 청구 모델 기준점 도출.

### 6-4. 사용자 행동 기반 기능 개선 (Data Flywheel)
* **행석 분석 툴 연동**: PostHog 또는 Mixpanel 도입을 통해 학생의 화면 체류 시간, 첫 질문까지 걸리는 시간, 포트폴리오 전환율 분석.
* **EWS (조기경보시스템) 피드백 루프**: 시스템이 식별한 '중도 탈락 위험군' 학생이 실제로 탈락하는지, 아니면 AI 개입으로 회복하는지에 대한 정확률 튜닝.
