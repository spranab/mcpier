# @mcpier/server

The Pier control plane — Fastify API, encrypted SQLite secret store, manifest loader, static UI server.

## Run locally

```bash
cp .env.example .env
# edit .env — at minimum, set PIER_MASTER_KEY and PIER_TOKENS
cp manifest.example.yaml manifest.yaml
npm run dev
```

Server starts on `http://0.0.0.0:8420`.

## API

All routes under `/api/*` require `Authorization: Bearer <token>` where the token is in `PIER_TOKENS`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness (no auth) |
| `GET` | `/api/manifest` | Fetch full manifest |
| `PUT` | `/api/manifest` | Replace manifest |
| `GET` | `/api/secrets` | List secret keys (not values) |
| `PUT` | `/api/secrets` | Set one secret (`{ key, value }`) |
| `POST` | `/api/secrets/fetch` | Fetch multiple secret values (`{ keys: [...] }`) |
| `DELETE` | `/api/secrets/:key` | Delete a secret |

## Storage

SQLite at `$PIER_DATA_DIR/pier.db`. Secrets are encrypted with AES-256-GCM using a key derived via scrypt from `PIER_MASTER_KEY`.
