# ============================================================
# OpenMento API Server — Multi-stage Dockerfile
# Stages: base → deps → dev (hot-reload) | builder → production
# ============================================================

FROM node:24-alpine AS base
RUN npm install -g pnpm@10
WORKDIR /app

# ── 의존성 설치 ──────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/rag/package.json ./packages/rag/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── 개발 (nodemon hot-reload) ────────────────────────────────
FROM deps AS dev
COPY . .
EXPOSE 3000 3001
USER node
CMD ["pnpm", "--filter", "@openmento/server", "dev"]

# ── 빌드 ────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm --filter @openmento/shared build || true
RUN pnpm --filter @openmento/db build || true
RUN pnpm --filter @openmento/rag build || true
RUN pnpm --filter @openmento/server build

# ── 프로덕션 ─────────────────────────────────────────────────
FROM node:24-alpine AS production
RUN npm install -g pnpm@10
WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/rag/package.json ./packages/rag/
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/db/dist/ ./packages/db/dist/
COPY --from=builder /app/packages/rag/dist/ ./packages/rag/dist/
COPY --from=builder /app/server/dist/ ./server/dist/
RUN pnpm install --prod
EXPOSE 3000
USER node
CMD ["node", "server/dist/index.js"]
