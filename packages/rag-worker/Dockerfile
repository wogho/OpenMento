# ============================================================
# OpenMento RAG Worker — Multi-stage Dockerfile
# Plan.md Phase 5-A: API 서버와 분리된 임베딩 처리 독립 프로세스
#
# 빌드:  docker compose build rag-worker
# 실행:  docker compose up rag-worker
# ============================================================

FROM node:24-alpine AS base
RUN npm install -g pnpm@10
WORKDIR /app

# ── 의존성 설치 ──────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/rag/package.json ./packages/rag/
COPY packages/rag-worker/package.json ./packages/rag-worker/
RUN pnpm install

# ── 빌드 ────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm --filter @openmento/shared build || true
RUN pnpm --filter @openmento/db build || true
RUN pnpm --filter @openmento/rag build || true
RUN pnpm --filter @openmento/rag-worker build

# ── 프로덕션 ─────────────────────────────────────────────────
FROM node:24-alpine AS production
RUN npm install -g pnpm@10
WORKDIR /app

# 공유 볼륨 마운트 포인트 생성 (API 서버가 업로드한 임시 파일에 접근)
RUN mkdir -p /tmp/uploads

COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/rag/package.json ./packages/rag/
COPY --from=builder /app/packages/rag-worker/package.json ./packages/rag-worker/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/db/dist/ ./packages/db/dist/
COPY --from=builder /app/packages/rag/dist/ ./packages/rag/dist/
COPY --from=builder /app/packages/rag-worker/dist/ ./packages/rag-worker/dist/
RUN pnpm install --prod

USER node
CMD ["node", "packages/rag-worker/dist/index.js"]
