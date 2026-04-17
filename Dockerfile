# syntax=docker/dockerfile:1.7

# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 + other native deps need python/make/g++
RUN apk add --no-cache python3 make g++

# Manifest layer (cache-friendly): deps only change when lockfile/package files change.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json  packages/shared/
COPY packages/server/package.json  packages/server/
COPY packages/cli/package.json     packages/cli/
COPY packages/ui/package.json      packages/ui/

RUN npm ci --workspaces --include-workspace-root

# Sources
COPY packages/shared  packages/shared
COPY packages/server  packages/server
COPY packages/ui      packages/ui

# Build in dep order: shared (emits .d.ts + .js) → ui (uses shared types) → server (uses shared types).
RUN npm run build -w @mcpier/shared \
 && npm run build -w @mcpier/ui \
 && npm run build -w @mcpier/server


# ---------- runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install production deps for @mcpier/server only (shared is a path-ref workspace).
RUN apk add --no-cache python3 make g++
COPY --from=builder /app/package.json             /app/package-lock.json* ./
COPY --from=builder /app/packages/shared/package.json  packages/shared/
COPY --from=builder /app/packages/shared/dist          packages/shared/dist
COPY --from=builder /app/packages/server/package.json  packages/server/
COPY --from=builder /app/packages/server/dist          packages/server/dist
COPY --from=builder /app/packages/ui/dist              packages/ui/dist

RUN npm ci --omit=dev --workspace @mcpier/server --include-workspace-root \
 && apk del python3 make g++ \
 && apk add --no-cache util-linux python3 py3-pip \
 && pip install --no-cache-dir --break-system-packages uv \
 && rm -rf /root/.npm /root/.cache /tmp/*

# /data must exist and be writable by the `node` user BEFORE VOLUME is declared
# so bind-mounts and anonymous volumes both inherit the right owner.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV PIER_HOST=0.0.0.0
ENV PIER_PORT=8420
ENV PIER_DATA_DIR=/data
ENV PIER_MANIFEST_PATH=/data/manifest.yaml
ENV PIER_UI_DIR=/app/packages/ui/dist

VOLUME ["/data"]
EXPOSE 8420

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PIER_PORT:-8420}/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
