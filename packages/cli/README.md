# mcpier

[![npm version](https://img.shields.io/npm/v/mcpier.svg)](https://www.npmjs.com/package/mcpier)
[![ci](https://github.com/spranab/mcpier/actions/workflows/ci.yml/badge.svg)](https://github.com/spranab/mcpier/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/spranab/mcpier/blob/main/LICENSE)

**CLI for [Pier](https://github.com/spranab/mcpier)** — a self-hosted control plane for Model Context Protocol servers.

`pier` points at a Pier server running on your homelab and keeps every client machine in sync with it. One manifest on the server, one `pier sync` on every laptop. No API keys in `~/.claude.json`. Install new MCPs with one command.

## Install

```bash
npm i -g mcpier
```

Requires Node 20+. Installs the `pier` binary globally.

## Prerequisites

A running Pier server. Deploy one in a single command — see the [main repo](https://github.com/spranab/mcpier#install) for Docker, Docker Compose, and Kubernetes one-liners.

## Quickstart

```bash
# Point CLI at your Pier server (once per machine)
pier login http://pier.homelab:8420 --token <your-device-token>

# Install an MCP — prompts for secrets, stores them on Pier, writes the client config
pier install brainstorm-mcp --location remote --sync claude-code

# Restart Claude Code → brainstorm_* tools live
```

Or scripted:

```bash
pier install brainstorm-mcp --location remote --non-interactive \
  --set openai_key=sk-... \
  --set gemini_key=... \
  --sync claude-code
```

Or from any git repo shipping a `pier.yaml` at its root:

```bash
pier install-git github.com/spranab/some-mcp --sync claude-code
```

## Commands

| Command | What it does |
|---|---|
| `pier login <server> --token <t>` | Save server URL + device token to `~/.config/pier/config.json` |
| `pier status` | Show server health, manifest summary, spawned MCPs, secret count |
| `pier install <name>` | Install from a subscribed catalog (interactive) |
| `pier install-git <url>` | Install from a git repo or raw `pier.yaml` URL |
| `pier sync` | Pull manifest + secrets and write client configs (default: `claude-code`) |
| `pier sync --clients claude-code,cursor,codex` | Sync multiple clients in one call |
| `pier secrets list` | List secret keys stored on the server (not values) |
| `pier secrets set <key> <value>` | Store a secret (AES-256-GCM encrypted at rest) |
| `pier backup -o <file>` | Download a JSON bundle (encrypted DB + manifest) |
| `pier restore <file>` | Restore from a bundle — same `PIER_MASTER_KEY` required |

### `install` options

| Flag | Purpose |
|---|---|
| `--as <name>` | Install under a different manifest key |
| `--location <mode>` | Skip the where-to-run prompt: `local` (client spawns) or `remote` (Pier spawns, clients get a URL) |
| `--set <key=value>` | Pre-supply a secret (repeatable) |
| `--non-interactive` | Fail instead of asking for missing values |
| `--source <name>` | Narrow to a single subscribed catalog |
| `--sync <clients>` | Run `pier sync --clients <clients>` after install |

Run `pier <command> --help` for full details.

## Supported clients (via `pier sync`)

- Claude Code (`~/.claude.json`)
- Claude Desktop (platform-specific path)
- Cursor (`~/.cursor/mcp.json`)
- Codex (`~/.codex/config.toml`)

(Continue, Windsurf, and VS Code / GitHub Copilot support coming.)

## Catalogs subscribed by default

- **[registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io)** — the official MCP Registry (namespace-verified)
- **[mcpier-catalog](https://github.com/spranab/mcpier-catalog)** — curated starter + community feeds

Anything not in a subscribed catalog installs one paste away via `pier install-git`.

## Trust model

Pier's UI and CLI label sources by authority:

| Source | Badge | Why |
|---|---|---|
| MCP Registry | ✓ **registry** (green) | Reverse-DNS namespace verified via GitHub OAuth / DNS TXT — unforgeable per namespace |
| Subscribed `catalog.json` feeds | ✓ **curated** (amber) | Maintainer-attested in PR; you trust the catalog |
| `install-git` | (no badge) | Explicit user confirmation; you trust the URL |

## Links

- **Source**: https://github.com/spranab/mcpier
- **Server deploy**: https://github.com/spranab/mcpier#install
- **Issues**: https://github.com/spranab/mcpier/issues
- **Releases**: https://github.com/spranab/mcpier/releases

## License

MIT.
