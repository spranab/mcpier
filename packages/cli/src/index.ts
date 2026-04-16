#!/usr/bin/env node
import { Command } from "commander";
import { loginCmd } from "./commands/login.js";
import { syncCmd } from "./commands/sync.js";
import { statusCmd } from "./commands/status.js";
import { secretsListCmd, secretsSetCmd } from "./commands/secrets.js";
import { backupCmd } from "./commands/backup.js";
import { restoreCmd } from "./commands/restore.js";

const program = new Command();

program
  .name("pier")
  .description("self-hosted MCP control plane — sync configs and secrets from your homelab")
  .version("0.1.0");

program
  .command("login <server>")
  .description("save server URL and device token locally")
  .requiredOption("--token <token>", "device token from your homelab")
  .action(async (server: string, opts: { token: string }) => {
    await loginCmd(server, opts);
  });

program
  .command("status")
  .description("show server health, manifest summary, and secrets count")
  .action(async () => {
    await statusCmd();
  });

program
  .command("sync")
  .description("pull manifest + secrets and write client configs")
  .option(
    "--clients <list>",
    "comma-separated: claude-code,claude-desktop,cursor,codex",
    "claude-code",
  )
  .option("--dry-run", "render but do not write", false)
  .action(async (opts: { clients: string; dryRun: boolean }) => {
    await syncCmd({ clients: opts.clients.split(","), dryRun: opts.dryRun });
  });

program
  .command("backup")
  .description("download a JSON bundle of the server's manifest + encrypted DB")
  .option("-o, --output <path>", "write to file (default: stdout)")
  .action(async (opts: { output?: string }) => {
    await backupCmd(opts);
  });

program
  .command("restore <path>")
  .description("restore the server from a backup JSON bundle (same master key required)")
  .option("-y, --yes", "skip the confirmation prompt", false)
  .action(async (path: string, opts: { yes: boolean }) => {
    await restoreCmd(path, opts);
  });

const secrets = program.command("secrets").description("manage secrets on the server");
secrets.command("list").description("list secret keys").action(secretsListCmd);
secrets
  .command("set <key> <value>")
  .description("set a secret value")
  .action(secretsSetCmd);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
