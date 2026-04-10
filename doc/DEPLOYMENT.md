# 배포 모드

상태: 정식 배포 및 인증 모드 모델  
최종 업데이트: 2026-04

## 1. 개요

OpenMento은 두 가지 런타임 모드를 지원합니다:

1. `local_trusted`
2. `authenticated`

`authenticated` 모드는 두 가지 노출 정책을 지원합니다:

1. `private`
2. `public`

이 구조는 단일 인증 스택을 유지하면서 로컬 개발의 낮은 진입 장벽과 인터넷 배포의 보안 강화 요구를 동시에 충족합니다.

## 2. 정식 모델

| 런타임 모드 | 노출 | 인증 | 주요 사용 사례 |
|---|---|---|---|
| `local_trusted` | 없음 | 로그인 불필요 | 단일 운영자 로컬 개발 워크플로우 |
| `authenticated` | `private` | 로그인 필요 | 사설 네트워크 접근 (예: Tailscale/VPN/LAN) |
| `authenticated` | `public` | 로그인 필요 | 인터넷 배포 / 클라우드 서비스 |

## 3. 보안 정책

### `local_trusted`

- 루프백 전용 호스트 바인딩 (`127.0.0.1`)
- 인간 로그인 흐름 없음
- 가장 빠른 로컬 시작에 최적화

### `authenticated + private`

- 로그인 필수
- 낮은 마찰 URL 처리 (`auto` 기본 URL 모드)
- 사설 호스트 신뢰 정책 적용

### `authenticated + public`

- 로그인 필수
- 명시적 공개 URL 필수 (`PUBLIC_URL` 환경변수)
- 엄격한 배포 검사 적용
- HTTPS 필수

## 4. 환경변수

```sh
# 필수
BETTER_AUTH_SECRET=<32바이트 이상의 랜덤 시크릿>
DATABASE_URL=postgres://...

# 인증 모드
AUTH_MODE=local_trusted | authenticated

# 공개 배포 시
PUBLIC_URL=https://yourdomain.com

# AI 에이전트 API 키
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=...
```

## 5. 프로덕션 배포 체크리스트

```
[ ] DATABASE_URL이 관리형 PostgreSQL을 가리키는지 확인
[ ] pgvector 확장 활성화 확인
[ ] BETTER_AUTH_SECRET이 강력한 랜덤 값인지 확인
[ ] AUTH_MODE=authenticated 설정
[ ] PUBLIC_URL이 올바른 도메인인지 확인
[ ] HTTPS 인증서 설정 완료
[ ] 데이터베이스 백업 정책 수립
[ ] 에이전트별 월간 예산 한도 설정
```

## 6. Docker 배포

### 원클릭 (임베디드 DB)

단일 컨테이너, 외부 데이터베이스 불필요:

```sh
BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  docker compose -f docker/docker-compose.quickstart.yml up --build
```

`http://localhost:3100` 열기

데이터 영속성 — 다음이 바인드 마운트에 저장됩니다:
- 임베디드 PostgreSQL 데이터
- 업로드된 교육 자료
- 로컬 시크릿 키
- 에이전트 워크스페이스 데이터

### 외부 PostgreSQL 연동

```sh
BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
DATABASE_URL=postgres://user:pass@host:5432/openmento \
  docker compose -f docker/docker-compose.yml up --build
```

## 7. 클라우드 플랫폼 배포

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

1. 레포지토리를 Railway에 연결
2. PostgreSQL 플러그인 추가 (pgvector 지원 포함)
3. 환경변수 설정
4. 자동 배포

### Vercel (UI 분리 배포)

API 서버와 UI를 분리하여 배포하는 경우:

```sh
# UI만 Vercel에 배포
cd ui
vercel deploy
```

`VITE_API_URL`을 API 서버 주소로 설정합니다.
