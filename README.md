# Pier

[![ci](https://github.com/spranab/mcpier/actions/workflows/ci.yml/badge.svg)](https://github.com/spranab/mcpier/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcpier.svg)](https://www.npmjs.com/package/mcpier)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**MCPs, simpler.** Self-hosted control plane for Model Context Protocol servers.

One YAML manifest on your homelab, `pier sync` on every client, zero API keys in `~/.claude.json`. Install MCPs from the [official MCP Registry](https://registry.modelcontextprotocol.io), community catalogs, or any git repo. Spawn them centrally so clients just point at a URL — no `npx` or `uvx` on your laptop.

## The problem

You run MCPs across five machines. Each `~/.claude.json` has your OpenAI key, Gemini key, GitHub token — in plaintext. Adding a new MCP means editing five files. Rotating a key means editing five files. Pick up a new laptop? Copy-paste five configs. Hit the 8-server / 60-second timeout wall and everything falls over.

Public directories (mcp.so, Smithery) don't help — your secrets aren't in them. Client-side tools (mcp-linker) sync configs on one machine but charge for cross-device and still leave keys on disk in cleartext. Anthropic's MCP Registry is read-only discovery; it can't actually install for you.

## What Pier does

- **One manifest, one source of truth.** YAML on your homelab describes every MCP you use — transport, runtime, which secrets it needs.
- **Secrets stay on the server.** AES-256-GCM encrypted at rest. CLI fetches them only when writing a client config, over an authenticated channel. Optional file-backed master key (`PIER_MASTER_KEY_FILE`) for Docker/K8s secret mounts.
- **Multi-client output.** Writes `~/.claude.json`, Cursor's `mcp.json`, Codex's `config.toml`. More on the way.
- **Gateway for remote-eligible MCPs.** Pier spawns the MCP subprocess on your homelab and fronts it over SSE. Clients put ONE URL entry in their config; secrets never touch the client. Dodges the 8-server timeout by design.
- **Built-in marketplace.** Subscribed to the official MCP Registry out of the box — namespace-authenticated entries (`com.stripe/mcp`, `io.github.*`). Plus curated feeds for community servers. Plus `pier install-git <url>` for anything else.
- **Self-hosted, open source, MIT.** Your homelab, your keys, your network. No SaaS tier.

## Architecture

```
┌─────────────────┐            ┌──────────────────────────┐
│  Homelab        │            │  Your laptop / desktop   │
│                 │            │                          │
│  ┌───────────┐  │            │  ┌────────────────────┐  │
│  │  Pier     │◄─┼──HTTP(S)───┤  │  pier CLI          │  │
│  │  server   │  │            │  │  (writes configs)  │  │
│  │           │  │            │  └────────────────────┘  │
│  │  API      │  │            │                          │
│  │  UI       │◄─┼──browser───┤  ~/.claude.json          │
│  │  Gateway  │  │            │  ~/.cursor/mcp.json      │
│  │  ┌─────┐  │  │            │  ~/.codex/config.toml    │
│  │  │MCP-1│  │  │            │                          │
│  │  │MCP-2│◄─┼──┼──SSE───────┤  Claude Code / Cursor    │
│  │  │MCP-N│  │  │            │  (one URL per remote MCP)│
│  │  └─────┘  │  │            │                          │
│  └───────────┘  │            └──────────────────────────┘
│       │         │
│       ▼         │
│   SQLite        │
│   (encrypted    │
│    secrets,     │
│    manifest,    │
│    audit log)   │
└─────────────────┘
```

## Install

### Server (pick one)

| Runtime | One command |
|---|---|
| **Docker Compose** | `docker compose -f https://raw.githubusercontent.com/spranab/mcpier/main/deploy/compose/install.yml up -d` |
| **Docker run** | `docker run -d --name pier -p 8420:8420 -v pier-data:/data -e PIER_MASTER_KEY=$(openssl rand -hex 32) -e PIER_TOKENS=$(openssl rand -hex 24) ghcr.io/spranab/mcpier:latest` |
| **Kubernetes** | `kubectl apply -f https://raw.githubusercontent.com/spranab/mcpier/main/deploy/kubernetes/install.yaml` |

All three pull `ghcr.io/spranab/mcpier:latest`, bind to port **8420**, persist state to a named volume / PVC. The Docker Compose and Kubernetes install files ship with placeholder credentials so you get a working instance immediately — **rotate before storing real API keys** (see [deploy/compose/README.md](deploy/compose/README.md) / [deploy/kubernetes/README.md](deploy/kubernetes/README.md)).

### CLI (on every client machine)

```bash
npm i -g mcpier
```

Requires Node 20+. That puts the `pier` binary on your PATH.

## Quickstart

Once the server is up and the CLI is installed:

```bash
# 1. Point the CLI at your Pier server (once per machine)
pier login http://<your-host>:8420 --token <one-of-your-PIER_TOKENS>

# 2. Install an MCP — interactive prompts for secrets
pier install brainstorm-mcp --location remote --sync claude-code
#   ↑ finds it in the official catalog
#   ↑ prompts for OpenAI / Gemini / DeepSeek keys
#   ↑ stores them encrypted on Pier
#   ↑ writes the URL entry into ~/.claude.json

# 3. Restart Claude Code → brainstorm_* tools live
```

Or script it:

```bash
pier install brainstorm-mcp --location remote --non-interactive \
  --set openai_key=sk-... \
  --set gemini_key=... \
  --sync claude-code
```

Or from any repo with a `pier.yaml` at its root:

```bash
pier install-git github.com/spranab/some-mcp --sync claude-code
```

## CLI reference

| Command | What it does |
|---|---|
| `pier login <server> --token <t>` | Save server URL + device token to `~/.config/pier/config.json` |
| `pier status` | Show server health, manifest summary, secrets count |
| `pier install <name>` | Install from a subscribed catalog (interactive prompts) |
| `pier install-git <url>` | Install from a git repo or raw `pier.yaml` URL |
| `pier sync` | Pull manifest + secrets and write client configs (default: claude-code) |
| `pier sync --clients claude-code,cursor,codex` | Sync to multiple clients at once |
| `pier secrets list` | List secret keys stored on the server (not values) |
| `pier secrets set <key> <value>` | Store a secret (encrypted at rest) |
| `pier backup -o <file>` | Download JSON bundle (encrypted DB + manifest) |
| `pier restore <file>` | Restore from a bundle (same master key required) |

Run `pier <command> --help` for full flags.

## Runtime support

Pier installs MCPs written in any language:

| `runtime:` in formula | Command Pier generates | Prereq for `location: local` |
|---|---|---|
| `node` (default) | `npx -y <package>` | [Node.js](https://nodejs.org) 20+ |
| `python` | `uvx <package>` | [`uv`](https://docs.astral.sh/uv/) |
| `binary` | `<package> <args>` | The binary on `PATH` |

For `location: remote` (Pier spawns the subprocess itself), the prereq lives only on the Pier host. On Linux, spawned subprocesses run under a `prlimit --as` memory cap (default 512 MB, `PIER_SPAWN_MEMORY_MB`) so a runaway MCP can't OOM your homelab.

## Catalogs

Pier subscribes out of the box to:

- **[registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io)** — the official, namespace-authenticated registry backed by Anthropic, GitHub, Microsoft, PulseMCP
- **[mcpier-catalog (official)](https://github.com/spranab/mcpier-catalog/blob/main/catalog.json)** — a curated starter set of ~10 MCPs
- **[mcpier-catalog (community)](https://github.com/spranab/mcpier-catalog/blob/main/community.json)** — ~13 third-party vendor MCPs (Stripe, Cloudflare, Notion, Sentry, Slack, etc.)

Add any `catalog.json` URL via the UI's **Sources** panel, or by setting `PIER_CATALOG_URLS`. Anything not in your subscribed catalogs is one `pier install-git <url>` away.

## Trust model

Three tiers, clearly labeled in the UI:

| Badge | Source | Authority |
|---|---|---|
| ✓ **registry** (green) | Official MCP Registry | Namespace verified via GitHub OAuth or DNS TXT — unforgeable per namespace |
| ✓ **curated** (amber) | Subscribed `catalog.json` feeds | Soft — you trust the catalog maintainer |
| (no badge) | `pier install-git <url>` | Explicit user confirmation — you trust the URL |

## Deploy docs

- [deploy/compose/README.md](deploy/compose/README.md) — Docker Compose details + secret rotation
- [deploy/kubernetes/README.md](deploy/kubernetes/README.md) — K8s manifests, ingress tips for SSE, backups
- [packages/server/README.md](packages/server/README.md) — server config reference
- [packages/cli/README.md](packages/cli/README.md) — CLI reference

## Development

```bash
git clone https://github.com/spranab/mcpier && cd mcpier
npm install
npm run dev        # shared (watch) + server + UI
npm test           # crypto + manifest + config tests
npm run build      # production build of all workspaces
```

## Repo layout

- [packages/shared/](packages/shared/) — zod schemas (manifest, formula, catalog) used by server + CLI + UI
- [packages/server/](packages/server/) — Fastify API, encrypted SQLite, gateway, stdio-spawn bridge
- [packages/cli/](packages/cli/) — the `pier` binary (published to npm as `mcpier`)
- [packages/ui/](packages/ui/) — React + Vite web UI served by the server
- [deploy/](deploy/) — Docker Compose and Kubernetes manifests
- [.github/workflows/](.github/workflows/) — CI + tag-driven npm publish with provenance

## Releases

Published on npm as [`mcpier`](https://www.npmjs.com/package/mcpier). Images on GHCR as `ghcr.io/spranab/mcpier`. See the [releases page](https://github.com/spranab/mcpier/releases) for changelogs.

## License

MIT
