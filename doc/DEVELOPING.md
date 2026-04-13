# 개발 가이드

이 프로젝트는 PostgreSQL을 별도로 설치하지 않고도 로컬 개발 환경을 완전히 구동할 수 있습니다.

## 전제 조건

- Node.js 20+
- pnpm 9.15+
- Docker Desktop (선택 사항, 외부 DB 사용 시)

## 개발 서버 시작

레포지토리 루트에서 실행합니다:

```sh
pnpm install
pnpm dev
```

이렇게 하면 다음이 시작됩니다:

- API 서버: `http://localhost:3100`
- UI: API 서버가 개발 미들웨어 모드로 서빙 (API와 동일 오리진)

`pnpm dev`는 Watch 모드로 서버를 실행하고 워크스페이스 패키지 변경 시 자동으로 재시작합니다.

## 환경변수 설정

```sh
cp .env.example .env
```

웹 관리자 화면에서 `AI_API_KEY`, `DATABASE_URL` 등의 민감한 값을 설정합니다.  
`.env` 파일을 직접 편집하는 것은 권장하지 않습니다.

## 데이터베이스

`DATABASE_URL`을 설정하지 않으면 서버가 자동으로 임베디드 PostgreSQL 인스턴스를 시작합니다.

```sh
# 마이그레이션 적용
pnpm db:migrate

# 마이그레이션 파일 생성 (스키마 변경 후)
pnpm db:generate
```

로컬 개발 데이터 초기화:

```sh
rm -rf data/pglite
pnpm dev
```

## Docker를 사용한 개발

Docker Compose로 전체 스택을 한 번에 구동합니다:

```sh
pnpm docker:up
```

빌드 인수:

| 인수 | 기본값 | 설명 |
|------|--------|------|
| `USER_UID` | `1000` | 컨테이너 node 사용자 UID (권한 문제 방지를 위해 호스트 UID와 일치시킬 것) |
| `USER_GID` | `1000` | 컨테이너 node 그룹 GID |

```sh
docker build -t openmento-local \
  --build-arg USER_UID=$(id -u) --build-arg USER_GID=$(id -g) .
```

## 유용한 명령어

```sh
pnpm dev              # 전체 개발 서버 구동 (API + UI, Watch 모드)
pnpm build            # 전체 프로젝트 빌드
pnpm typecheck        # TypeScript 타입 검사
pnpm test:run         # 테스트 실행 (Playwright E2E 포함)
pnpm db:generate      # DB 마이그레이션 파일 생성
pnpm db:migrate       # 마이그레이션 적용
pnpm docker:up        # Docker Compose 전체 스택 구동
pnpm docker:down      # Docker Compose 중단
```

## 헬스 체크

개발 서버가 정상 구동되면 다음으로 확인합니다:

```sh
curl http://localhost:3100/api/health
```

## RAG 파이프라인 개발

pgvector 확장이 활성화된 PostgreSQL이 필요합니다. Docker Compose는 자동으로 설정합니다.

수동으로 활성화하는 경우:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

임베딩 워커는 BullMQ 기반으로 독립 실행됩니다:

```sh
pnpm --filter @openmento/rag-worker dev
```

## 배포 모드

배포 모드와 환경에 대한 자세한 내용은 [DEPLOYMENT.md](DEPLOYMENT.md)를 참조하세요.

## 트러블슈팅

**포트 충돌**: `3100` 포트가 이미 사용 중인 경우 `.env`에서 `PORT`를 변경합니다.

**DB 연결 오류**: `DATABASE_URL`이 올바른지 확인하고, Docker가 실행 중인지 점검합니다.

**타입 에러**: `pnpm typecheck` 실행 후 오류 메시지를 확인합니다. `tsconfig.base.json`을 기준으로 각 패키지가 상속받습니다.
