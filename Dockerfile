# Do'konim API — Fastify on Node 22, TypeScript run directly with tsx (no build step).
#   docker build -t dokonim-api .   (see docker-compose.yml for a full stack)

FROM node:22-alpine AS deps
WORKDIR /app
# Manifests first so the dependency layer is cached until a package.json / the lockfile changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/payments/package.json packages/payments/
COPY packages/seed/package.json packages/seed/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/miniapp/package.json apps/miniapp/
# Production deps of the workspaces (tsx is a runtime dependency of @dokonim/api); no lifecycle scripts.
RUN npm ci --workspaces --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=deps --chown=node:node /app ./
COPY --chown=node:node package.json tsconfig.base.json tsconfig.json ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps/api ./apps/api
COPY --chown=node:node apps/bot ./apps/bot
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
# Migrations run on boot (idempotent); `node_modules/.bin/tsx apps/api/src/migrate.ts` runs them alone.
CMD ["node_modules/.bin/tsx", "apps/api/src/main.ts"]
