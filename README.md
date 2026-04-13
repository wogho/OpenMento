<p align="center">
  <h1>OpenMento</h1>
  <p><strong>AI-powered Education Platform</strong></p>
  <p>다중 에이전트 오케스트레이션 기반 AI 교육 자율 운영 플랫폼</p>
</p>

<p align="center">
  <img src="ui/public/icons/icon-512.png" alt="OpenMento" width="80" />
</p>

<p align="center">
  <a href="#quickstart"><strong>빠른 시작</strong></a> &middot;
  <a href="doc/DEVELOPING.md"><strong>개발 문서</strong></a> &middot;
  <a href="https://github.com/wogho/OpenMento"><strong>GitHub</strong></a>
</p>

<p align="center">
  <a href="https://github.com/wogho/OpenMento/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

<br/>

## 데모

| 구분 | 링크 |
|------|------|
| 전체 데모 | [openmento.cloud](https://openmento.cloud/) |
| 수강생 데모 | [openmento.cloud/auth/student](https://openmento.cloud/auth/student) |
| 관리자 데모 | [openmento.cloud/login/admin](https://openmento.cloud/login/admin) |

> 데모는 로그인 계정 정보가 자동으로 기입됩니다.

<br/>

## OpenMento이란?

## AI 에이전트 기반의 교육 자율 운영 플랫폼

OpenMento는 AI 에이전트 팀을 조직하여 교육 기관의 운영 전반을 자동화하는 Node.js 서버와 React 대시보드입니다. 다양한 에이전트를 배치하고, 교육 목표를 할당하며, 단일 대시보드에서 에이전트의 작업과 비용을 추적할 수 있습니다.

겉으로는 작업 관리자처럼 보이지만, 내부적으로는 조직도, 예산 관리, 거버넌스, 목표 정렬, 에이전트 간 협업 체계를 갖추고 있습니다.

**커리큘럼이나 코드를 관리하는 것이 아닌, 교육 목표 달성을 관리합니다.**

|        | 단계            | 예시                                                                   |
| ------ | --------------- | ---------------------------------------------------------------------- |
| **01** | 목표 정의       | _"학생 맞춤형 수학 튜터링 서비스로 월 사용자 1만 명 달성"_             |
| **02** | 팀 구성         | 커리큘럼 설계자, 튜터 에이전트, 평가 담당자 — 어떤 모델이든 배치 가능  |
| **03** | 승인 및 실행    | 전략을 검토하고 예산을 설정한 후 실행. 대시보드에서 실시간 모니터링     |

<br/>

> **출시 예정: 기관 템플릿 마켓** — 커리큘럼 구성, 에이전트 설정, 스킬 세트가 포함된 전체 교육 기관 템플릿을 한 번의 클릭으로 내려받아 즉시 운영할 수 있습니다.

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>연동<br/>가능</strong></td>
    <td align="center"><img src="https://cdn.simpleicons.org/anthropic/000000" width="32" alt="Claude" /><br/><sub>Claude</sub></td>
    <td align="center"><img src="https://img.shields.io/badge/OpenAI-412991?logo=openai&logoColor=white&style=flat-square" height="32" alt="GPT-4o" /><br/><sub>GPT-4o</sub></td>
    <td align="center"><img src="https://cdn.simpleicons.org/googlegemini/4285F4" width="32" alt="Gemini" /><br/><sub>Gemini</sub></td>
    <td align="center"><img src="https://cdn.simpleicons.org/googlegemini/8AB4F8" width="32" alt="Gemini CLI" /><br/><sub>Gemini CLI</sub></td>
    <td align="center"><img src="https://cdn.simpleicons.org/curl/073551" width="32" alt="HTTP Webhook" /><br/><sub>HTTP API</sub></td>
  </tr>
</table>

<em>하트비트를 수신할 수 있다면, 어떤 에이전트든 배치 가능합니다.</em>
</div>

<br/>

## OpenMento가 적합한 경우

- AI 에이전트로 구성된 **자율 교육 기관**을 구축하려는 경우
- Claude, GPT 등 다양한 모델과 런타임의 에이전트들을 **공통된 교육 목표**를 향해 협력하게 만들려는 경우
- 다수의 AI 세션을 동시에 운영하며 각 에이전트가 무엇을 하는지 **추적하기 어려운** 경우
- 에이전트가 **24/7 자율 운영**되면서도 관리자와 교사가 필요할 때 언제든 감사·개입할 수 있어야 하는 경우
- 에이전트 운영 **비용을 모니터링**하고 예산을 강제 적용하려는 경우
- 스마트폰에서도 교육 운영 현황을 **원격으로 확인**하려는 경우

<br/>



## 우리가 해결하는 진짜 문제

OpenMento는 단순한 온라인 교육 플랫폼(LMS) 구축에 국한되지 않습니다.  
교강사, 수강생, 교육 운영자 등 **교육 현장 구성원들의 실질적인 문제**를 날카롭게 해결하는 AI 솔루션입니다.

<br/>

### 핵심 문제 정의

| 구성원 | 문제 |
| ------ | ---- |
| **수강생** | 획일적인 커리큘럼. 이해도 차이를 반영하지 못하는 진도. 의미없는 과제 반복. |
| **교강사** | 개별 피드백에 드는 과도한 시간. 학습 이탈 징후를 사후에야 인지. 평가의 일관성 부재. |
| **교육 운영자** | 수작업 중심의 수강생 관리. 비정형 데이터 속에 묻힌 운영 인사이트. 반복 업무로 인한 리소스 낭비. |

<br/>

## 주요 기능

<table>
<tr>
<td align="center" width="33%">
<h3>커스텀 에이전트 연동</h3>
어떤 에이전트든, 어떤 런타임이든 단일 조직도에 통합됩니다. 하트비트를 수신할 수 있다면 배치 가능합니다.
</td>
<td align="center" width="33%">
<h3>교육 목표 정렬</h3>
모든 작업은 기관의 최상위 목표와 연결됩니다. 에이전트는 무엇을 해야 하는지 그리고 왜 해야 하는지를 이해합니다.
</td>
<td align="center" width="33%">
<h3>하트비트 스케줄러</h3>
에이전트는 스케줄에 따라 깨어나 작업을 확인하고 실행합니다. 위임은 조직도를 따라 상하로 흐릅니다.
</td>
</tr>
<tr>
<td align="center">
<h3>예산 관리</h3>
에이전트별 월간 예산을 설정합니다. 한도에 도달하면 에이전트가 자동으로 중단되어 비용 초과를 방지합니다.
</td>
<td align="center">
<h3>멀티 기관 지원</h3>
단일 배포 환경에서 여러 교육 기관을 운영합니다. 완전한 데이터 격리와 단일 관제 화면을 제공합니다.
</td>
<td align="center">
<h3>티켓 시스템 및 감사 로그</h3>
모든 대화는 추적되고 모든 결정은 설명됩니다. 완전한 도구 호출 추적과 불변 감사 로그를 제공합니다.
</td>
</tr>
<tr>
<td align="center">
<h3>거버넌스</h3>
관리자가 이사회 역할을 합니다. 에이전트 배치 승인, 전략 재정의, 특정 에이전트 일시 정지 또는 종료가 언제든 가능합니다.
</td>
<td align="center">
<h3>RAG 파이프라인</h3>
pgvector 기반의 검색 증강 생성 파이프라인으로 교육 자료를 학습하여 문맥에 맞는 정확한 답변을 생성합니다.
</td>
<td align="center">
<h3>양산형 포트폴리오 방지</h3>
AI 시대의 교육 현장에서 가장 심각한 문제 중 하나는 AI 도구를 이용한 복붙·양산형 결과물의 범람입니다. OpenMento는 이를 구조적으로 차단합니다.
</td>
</tr>
</table>

<br/>

## 조직도

강사가 한눈에 관리할 수 있는 **GUI 기반 5계층 에이전트 조직도**입니다.

<div align="center">
<table>
<tr>
<td valign="top" width="38%">

| 계층 | 구성 요소 | 설명 |
|:----:|-----------|------|
| **1** | 강사 | 조직도 최상단 — 본인만 위치 |
| **2** | 과목 | 강사가 담당하는 강의 과목 |
| **3** | Skills | 과목에 연결된 AI 스킬셋 |
| **4** | 에이전트 | 스킬을 실행하는 AI 에이전트 |
| **5** | 수강생 | 에이전트와 연결된 수강생 |

</td>
<td valign="middle" width="62%">
<img src="ui/public/dashboard-preview-2.png" alt="에이전트 조직도" width="100%" style="border-radius:12px; border:1px solid #30363d; box-shadow:0 4px 24px rgba(0,0,0,0.4);" />
</td>
</tr>
</table>
</div>

<br/>

## OpenMento가 해결하는 문제

| OpenMento 없이                                                                                         | OpenMento 도입 후                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 여러 AI 세션을 동시에 띄워놓고 어느 에이전트가 무엇을 하는지 파악하기 어렵습니다.                     | 작업은 티켓 기반으로 관리되고, 대화는 스레드로 묶이며, 세션은 재시작 후에도 지속됩니다.                  |
| 여러 컨텍스트를 수동으로 조합해 에이전트에게 반복적으로 상기시켜야 합니다.                           | 목표 맥락이 작업을 통해 직접 전달되어 에이전트는 항상 현재 수행 이유를 인식합니다.                      |
| 에이전트 설정이 분산되어 있고, 작업 관리·커뮤니케이션·협업을 직접 구현해야 합니다.                    | 조직도, 티켓팅, 위임, 거버넌스가 기본 제공되어 스크립트 모음이 아닌 실제 기관처럼 운영됩니다.           |
| 루프 오류로 수백 달러가 낭비되고, 인지하기 전에 이미 할당량을 초과합니다.                            | 비용 추적이 토큰 예산을 표시하고, 예산 소진 시 에이전트를 자동 중단합니다.                              |
| 질의응답, 성적 리포트 등 반복 업무를 매번 수동으로 실행해야 합니다.                                   | 하트비트가 정기 업무를 스케줄에 따라 처리하고, 상위 에이전트가 결과를 감독합니다.                       |
| 아이디어가 생기면 직접 AI를 열고, 탭을 유지하며, 진행을 일일이 모니터링해야 합니다.                   | OpenMento에 작업을 추가하면 담당 에이전트가 완료 시까지 처리하고 상위 에이전트가 결과를 검토합니다.        |

<br/>


## OpenMento가 아닌 것

|                              |                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| **챗봇이 아닙니다**          | 에이전트에게는 역할과 업무가 있으며 채팅 창이 아닙니다.                                                  |
| **에이전트 프레임워크가 아닙니다** | 에이전트를 어떻게 만들지는 관여하지 않습니다. 에이전트들로 구성된 기관을 어떻게 운영할지를 다룹니다.   |
| **워크플로우 빌더가 아닙니다** | 드래그 앤 드롭 파이프라인이 없습니다. OpenMento은 교육 기관을 모델링합니다 — 조직도, 목표, 예산, 거버넌스 포함. |
| **프롬프트 관리자가 아닙니다** | 에이전트는 자체 프롬프트, 모델, 런타임을 가져옵니다. OpenMento은 에이전트들이 속한 조직을 관리합니다.    |
| **단일 에이전트 도구가 아닙니다** | 팀을 위한 플랫폼입니다. 에이전트가 한 명이라면 OpenMento이 필요 없을 수 있습니다. 스무 명이라면 반드시 필요합니다. |

<br/>

## Quickstart

오픈소스. 자체 호스팅. 별도 계정 불필요.

> **요구 사항:** Node.js 20+, pnpm 9.15+, Docker

### 1. 저장소 클론 및 의존성 설치

```bash
git clone https://github.com/wogho/OpenMento_Stage.git
cd OpenMento_Stage
pnpm install
```

### 2. 내부 패키지 빌드

```bash
pnpm --filter '!ui' --filter '!server' build
```

### 3. DB & Redis 컨테이너 시작

```bash
docker compose -f docker/docker-compose.yml up -d db redis
```

### 4. 환경변수 설정

```bash
cat > server/.env << 'EOF'
DATABASE_URL=postgresql://openmento_user:openmento_pass@localhost:5432/openmento_db
PORT=3000
NODE_ENV=development
JWT_SECRET=dev-secret-min-32-chars-for-local-only
REDIS_URL=redis://localhost:6379
TZ=Asia/Seoul
EOF
```

### 5. DB 마이그레이션 적용

```bash
cd packages/db
for f in $(cat drizzle/meta/_journal.json | python3 -c "
import json,sys
j=json.load(sys.stdin)
for e in j['entries']:
    print(e['tag'])
"); do
  sed 's/--> statement-breakpoint/;/g' drizzle/${f}.sql | \
    docker exec -i docker-db-1 psql -U openmento_user -d openmento_db
done
cd ../..
```

### 6. 개발 서버 시작

```bash
pnpm dev
```

- API: `http://localhost:3000`
- UI: `http://localhost:5173` (Vite dev server, `/api/*` → `localhost:3000` 프록시)

헬스 체크:
```bash
curl http://localhost:3000/health
```

### 이후 재실행

```bash
docker compose -f docker/docker-compose.yml up -d db redis
pnpm dev
```

### 접속

| 용도 | 주소 |
|------|------|
| UI | http://localhost:5173 |
| API 헬스체크 | http://localhost:3000/health |

> 서버가 처음 뜨면 브라우저에서 초기 설정 마법사(`/setup`)가 자동으로 표시됩니다.  
> 기관명, LLM API 키, 관리자 계정을 입력하면 설정이 완료됩니다.

<br/>

## FAQ

**일반적인 배포 구성은 어떻게 됩니까?**  
로컬 환경에서는 단일 Node.js 프로세스가 임베디드 Postgres와 로컬 파일 스토리지를 관리합니다. 프로덕션 환경에서는 외부 Postgres를 연결하고 원하는 방식으로 배포합니다. 기관, 에이전트, 목표를 설정하면 에이전트들이 나머지를 처리합니다.

**여러 기관을 동시에 운영할 수 있습니까?**  
네. 단일 배포 환경에서 완전한 데이터 격리를 유지하며 기관 수에 제한 없이 운영 가능합니다.

**에이전트가 지속적으로 실행됩니까?**  
기본적으로 에이전트는 예약된 하트비트와 이벤트 기반 트리거(작업 할당, 멘션 등)로 실행됩니다. 연속 에이전트도 연결할 수 있으며 OpenMento가 이를 조율합니다.

**RAG 파이프라인은 어떻게 작동합니까?**  
pgvector 확장을 사용하여 교육 문서를 벡터로 변환하고 저장합니다. 에이전트가 질의할 경우 관련 문서를 검색하여 컨텍스트와 함께 모델에 전달합니다.

<br/>

## 개발

```bash
# 전체 개발 서버 구동 (API :3000 + UI :5173, Watch 모드)
pnpm dev

pnpm build            # 전체 빌드
pnpm typecheck        # 타입 검사
pnpm test:run         # 테스트 실행
pnpm db:generate      # DB 마이그레이션 파일 생성
```

내부 패키지(db, shared, rag 등) 스키마 변경 후에는 반드시 재빌드가 필요합니다:
```bash
pnpm --filter '!ui' --filter '!server' build
```

전체 개발 가이드는 [doc/DEVELOPING.md](doc/DEVELOPING.md)를 참조하세요.

<br/>

## 기술 스택

| 레이어        | 기술                              |
| ------------- | --------------------------------- |
| 런타임        | Node.js 20 LTS + TypeScript       |
| 프론트엔드    | React 18 + Vite + Tailwind CSS    |
| 데이터베이스  | PostgreSQL 16 + pgvector 0.7+     |
| ORM           | Drizzle ORM + postgres.js         |
| 스케줄러      | Heartbeat 기반 주기 실행 시스템   |
| 컨테이너      | Docker Compose v2                 |
| AI 프로토콜   | MCP (Model Context Protocol)      |

<br/>

## 프로젝트 구조

```
openmento/
├── packages/
│   ├── db/        # Drizzle ORM 스키마 (교육 도메인)
│   ├── shared/    # 공유 타입 및 유틸리티
│   └── rag/       # RAG 파이프라인 (pgvector 연동)
├── server/        # Node.js 20+ API + 에이전트 오케스트레이터
├── ui/            # React 18+ 대시보드 (Tailwind CSS)
├── skills/        # 에이전트 스킬 파일 예시 (.md)
├── docker/        # Docker Compose 설정
└── tests/e2e/     # Playwright E2E 테스트
```

<br/>

## 로드맵

- 플러그인 시스템 (지식 베이스, 커스텀 트레이싱, 큐 등)
- 에이전트 직원 관리 시스템
- 기관 내보내기 및 가져오기
- AGENTS.md 손쉬운 설정
- 스킬 매니저
- 예약 루틴
- 향상된 예산 관리
- ⬜ 산출물 및 배포 관리
- ⬜ 관리자 채팅
- ⬜ 다중 사용자 지원
- ⬜ 클라우드 / 샌드박스 에이전트
- ⬜ 클라우드 배포
- ⬜ 데스크톱 앱

<br/>

## 기여

기여를 환영합니다. 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요.

<br/>

## 커뮤니티

- [GitHub Issues](https://github.com/wogho/OpenMento/issues) — 버그 리포트 및 기능 요청
- [GitHub Discussions](https://github.com/wogho/OpenMento/discussions) — 아이디어 및 RFC

<br/>

## 라이선스

MIT &copy; 2026 OpenMento
