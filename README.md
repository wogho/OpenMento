# EduClip

> AI-powered Education Platform  
> 다중 에이전트 오케스트레이션 기반 AI 교육 자율 운영 플랫폼

## 빠른 시작

```bash
# 1. 환경변수 설정
cp .env.example .env
# .env 파일은 직접 편집하지 말고 웹 관리자 화면에서 설정하세요.

# 2. 의존성 설치
pnpm install

# 3. 전체 서비스 구동 (단일 명령)
pnpm docker:up

# 4. DB 마이그레이션
pnpm db:migrate

# 5. 개발 서버 시작
pnpm dev
```

## 프로젝트 구조

```
educlip/
├── packages/
│   ├── db/        # Drizzle ORM 스키마 (paperclip 차용 + 교육 도메인)
│   ├── shared/    # 공유 타입 및 유틸리티
│   └── rag/       # RAG 파이프라인 (pgvector 연동)
├── server/        # Node.js 20+ API + 에이전트 오케스트레이터
├── ui/            # React 18+ 대시보드 (Tailwind CSS)
├── skills/        # 스킬 파일 예시 (.md)
├── docker/        # Docker Compose 설정
└── tests/e2e/     # Playwright E2E 테스트
```

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 런타임 | Node.js 20 LTS + TypeScript |
| 프론트엔드 | React 18 + Vite + Tailwind CSS |
| 데이터베이스 | PostgreSQL 16 + pgvector 0.7+ |
| ORM | Drizzle ORM + postgres.js |
| 스케줄러 | Heartbeat (paperclip 차용) |
| 컨테이너 | Docker Compose v2 |
| AI 프로토콜 | MCP (Model Context Protocol) |

## 참조 오픈소스

paperclip (MIT License) — DB 스키마·Heartbeat·Skill Injection 구조 차용  
https://github.com/paperclipai/paperclip
