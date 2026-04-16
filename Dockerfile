FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/

RUN npm install --workspaces --include-workspace-root

COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/ui packages/ui

RUN npm run build -w @mcpier/ui
RUN npm run build -w @mcpier/server

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/src packages/shared/src
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/ui/dist packages/ui/dist

RUN apk add --no-cache python3 make g++ \
  && npm install --omit=dev --workspace @mcpier/server --include-workspace-root \
  && apk del python3 make g++

ENV PIER_UI_DIR=/app/packages/ui/dist
ENV PIER_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8420
CMD ["node", "packages/server/dist/index.js"]
