# Pier with Docker Compose

Two install paths depending on what you're optimizing for:

## One-command install (dev / homelab)

Pulls the prebuilt image from GHCR — no git clone, no build:

```bash
docker compose -f https://raw.githubusercontent.com/spranab/mcpier/main/deploy/compose/install.yml up -d
```

Pier comes up at `http://localhost:8420`. Sign in with the placeholder token:
```
pier-dev-token-rotate-me-before-storing-real-secrets
```

Needs Docker Compose v2.29+ for the remote `-f URL` syntax. On older versions:
```bash
curl -O https://raw.githubusercontent.com/spranab/mcpier/main/deploy/compose/install.yml
docker compose -f install.yml up -d
```

### Rotate the placeholder credentials before real use

`PIER_MASTER_KEY` is the at-rest encryption key for Pier's secret store — any secret stored under the placeholder key becomes unreadable after rotation, so rotate while the box is empty:

```bash
docker compose -f install.yml down

cat > override.yml <<EOF
services:
  pier:
    environment:
      PIER_MASTER_KEY: "$(openssl rand -hex 32)"
      PIER_TOKENS: "$(openssl rand -hex 24)"
EOF

docker compose -f install.yml -f override.yml up -d
```

Add more device tokens by comma-separating: `PIER_TOKENS: "$(openssl rand -hex 24),$(openssl rand -hex 24)"`. Each machine that `pier sync`s uses one.

## Dev install (clone + build from source)

```bash
git clone https://github.com/spranab/mcpier && cd mcpier
cp .env.example .env     # fill PIER_MASTER_KEY + PIER_TOKENS with openssl rand
docker compose up -d     # builds image locally from Dockerfile
```

Use this when you're developing Pier itself — the compose file at the repo root builds from the local `Dockerfile`.
