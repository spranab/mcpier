# Pier

[![ci](https://github.com/spranab/mcpier/actions/workflows/ci.yml/badge.svg)](https://github.com/spranab/mcpier/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**MCPs, simpler.**

A self-hosted control plane for your Model Context Protocol servers. One manifest on your homelab, one `pier sync` on every machine, zero plaintext API keys in `~/.claude.json`.

## The problem

You run MCPs across five machines. Each one has `~/.claude.json` with your OpenAI key, Gemini key, GitHub token, Anthropic key — in plaintext. Adding a new MCP means editing five files. Rotating a key means editing five files. Pick up a new laptop? Copy-paste five configs.

Public registries (mcp.so, Smithery, Anthropic's registry) don't help because your secrets aren't in them. Client-side tools (mcp-linker) sync configs locally on one machine but charge for cross-device sync and still leave your keys on disk in cleartext.

## What Pier does

- **One manifest, one source of truth.** YAML file describes every MCP you use: transport, runtime, which secrets it needs.
- **Secrets stay on the server.** Encrypted at rest on your homelab. CLI fetches them only when writing a client config, over an authenticated channel.
- **Multi-client output.** Writes `~/.claude.json`, Cursor's `mcp.json`, Continue's `mcpServers/`, Codex's `~/.codex/config.toml` — pick which.
- **Optional gateway mode.** Server fronts N upstream MCPs behind one HTTP/SSE endpoint. Clients have one config entry total. Dodges the 8-server/60-second timeout wall.
- **Self-hosted.** Your homelab, your keys, your network. Docker-compose up and you're done.

## Architecture

```
┌─────────────────┐            ┌──────────────────────────┐
│  Homelab        │            │  Your laptop / desktop   │
│                 │            │                          │
│  ┌───────────┐  │            │  ┌────────────────────┐  │
│  │  Pier     │  │◄───HTTPS───┤  │  pier CLI          │  │
│  │  server   │  │            │  │  (writes configs)  │  │
│  │           │  │            │  └────────────────────┘  │
│  │  - API    │  │            │                          │
│  │  - UI     │  │            │  ~/.claude.json          │
│  │  - Gateway│  │            │  ~/.cursor/mcp.json      │
│  └───────────┘  │            │  ~/.codex/config.toml    │
│       │         │            └──────────────────────────┘
│       ▼         │
│   SQLite        │
│   (secrets,     │
│    manifests,   │
│    audit)       │
└─────────────────┘
```

## Deploy — one-liner for each runtime

| Runtime | One command |
|---|---|
| **Docker Compose** | `docker compose -f https://raw.githubusercontent.com/spranab/mcpier/main/deploy/compose/install.yml up -d` |
| **Docker run** | `docker run -d --name pier -p 8420:8420 -v pier-data:/data -e PIER_MASTER_KEY=0000000000000000000000000000000000000000000000000000000000000000 -e PIER_TOKENS=pier-dev-token-rotate-me-before-storing-real-secrets ghcr.io/spranab/mcpier:latest` |
| **Kubernetes** | `kubectl apply -f https://raw.githubusercontent.com/spranab/mcpier/main/deploy/kubernetes/install.yaml` |

All three pull `ghcr.io/spranab/mcpier:latest`, bind to port **8420**, persist to a named volume / PVC, and come up with **placeholder credentials** so you can open the UI immediately. Rotate before storing real API keys — see [deploy/compose/README.md](deploy/compose/README.md) or [deploy/kubernetes/README.md](deploy/kubernetes/README.md).

## Quickstart — Docker (recommended for first run)

```bash
git clone https://github.com/spranab/mcpier
cd mcpier
cp .env.example .env

# Fill these in .env:
#   PIER_MASTER_KEY   (openssl rand -hex 32)
#   PIER_TOKENS       (openssl rand -hex 24, one per machine you'll sync from)

docker compose up -d
# → http://<host>:8420  (healthcheck visible in `docker compose ps`)
```

Data persists in the named volume `pier-data`. Secrets are AES-256-GCM encrypted at rest. The container runs as the non-root `node` user (uid 1000).

### Plugging a client into it

Install the CLI on each machine:

```bash
npm i -g mcpier
pier login http://<your-host>:8420 --token <one-of-your-PIER_TOKENS>
pier sync                                                  # writes ~/.claude.json
```

Then open `http://<your-host>:8420` in a browser, sign in with the same token, Browse → install from the **official MCP Registry** (always-on), from the curated feeds (mcpier-catalog + community), or paste any git URL.

## Development

```bash
npm install
npm run dev        # shared (watch) + server + ui, three processes
```

See [packages/server/README.md](packages/server/README.md) and [packages/cli/README.md](packages/cli/README.md) for package-level detail.

## Runtime support

Pier installs MCPs written in any language — you just tell it which runtime to use:

| `runtime:` in formula | Command Pier generates | Prereq on each client (for `location: local`) |
|---|---|---|
| `node` (default) | `npx -y <package>` | [Node.js](https://nodejs.org) 18+ |
| `python` | `uvx <package>` | [`uv`](https://docs.astral.sh/uv/) |
| `binary` | `<package> <args>` | The binary on `PATH` |

For servers with `location: remote` (gateway-fronted), the prereq lives on the Pier host only. Clients just point at a URL — no runtimes to install anywhere.

The official catalog ships examples of both:
- Node: [brainstorm-mcp](https://github.com/spranab/brainstorm-mcp) (multi-model AI)
- Python: [mcp-server-time](https://github.com/modelcontextprotocol/servers/tree/main/src/time), [mcp-server-git](https://github.com/modelcontextprotocol/servers/tree/main/src/git)

## Repo layout

- [packages/shared/](packages/shared/) — zod schemas shared across server + CLI + UI
- [packages/server/](packages/server/) — Fastify API, SQLite secrets, optional gateway
- [packages/cli/](packages/cli/) — the `pier` binary
- [packages/ui/](packages/ui/) — React + Vite web UI served by the server

## Status

Pre-alpha. Scaffolding stage. See [Todos](#) in the repo issues once live.

## License

MIT
