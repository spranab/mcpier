# pier CLI

```bash
npm install -g mcpier
```

## Commands

```bash
pier login https://pier.homelab --token <device-token>
pier status
pier sync                                          # defaults to claude-code
pier sync --clients claude-code,cursor,codex
pier sync --dry-run
pier secrets list
pier secrets set openai_key sk-...
```

Config is stored at `~/.config/pier/config.json`.
