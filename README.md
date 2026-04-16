# Pier

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

## Quickstart

See [packages/server/README.md](packages/server/README.md) to run the server and [packages/cli/README.md](packages/cli/README.md) to use the CLI.

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
