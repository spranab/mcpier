#!/usr/bin/env node
import { Command } from "commander";
import { loginCmd } from "./commands/login.js";
import { syncCmd } from "./commands/sync.js";
import { statusCmd } from "./commands/status.js";
import { secretsListCmd, secretsSetCmd } from "./commands/secrets.js";
import { backupCmd } from "./commands/backup.js";
import { restoreCmd } from "./commands/restore.js";
import { installCmd, installGitCmd, type InstallOptions } from "./commands/install.js";

const program = new Command();

program
  .name("pier")
  .description("self-hosted MCP control plane — sync configs and secrets from your homelab")
  .version("0.1.1");

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

function installOptions<T extends import("commander").Command>(cmd: T): T {
  return cmd
    .option("--as <name>", "install as a different key in the manifest")
    .option("--location <mode>", "local | remote (prompts otherwise)")
    .option("--set <key=value...>", "pre-set a secret (repeatable)", (v, all: string[]) => [...all, v], [])
    .option("--non-interactive", "fail instead of asking for missing values")
    .option("--sync <clients>", "run `pier sync --clients <...>` after install")
    .option("--source <name>", "narrow to a single subscribed catalog") as T;
}

installOptions(program.command("install <name>"))
  .description("install an MCP from a subscribed catalog (interactive secrets)")
  .action(async (name: string, opts: InstallOptions) => {
    await installCmd(name, opts);
  });

installOptions(program.command("install-git <url>"))
  .description("install from a git repo or raw pier.yaml URL (unverified)")
  .action(async (url: string, opts: InstallOptions) => {
    await installGitCmd(url, opts);
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
