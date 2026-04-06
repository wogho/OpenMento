# ============================================================
# EduClip UI — Multi-stage Dockerfile
# Stages: base → deps → dev (Vite) | builder → production (Nginx)
# ============================================================

FROM node:24-alpine AS base
RUN npm install -g pnpm@10
WORKDIR /app

# ── 의존성 설치 ──────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY ui/package.json ./ui/
RUN pnpm install

# ── 개발 (Vite dev server) ───────────────────────────────────
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@educlip/ui", "dev", "--host", "0.0.0.0"]

# ── 빌드 ────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm --filter @educlip/shared build || true
RUN pnpm --filter @educlip/ui build

# ── 프로덕션 (Nginx) ─────────────────────────────────────────
FROM nginx:1.27-alpine AS production
COPY --from=builder /app/ui/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
