#!/usr/bin/env node
import { Command } from "commander";
import { loginCmd } from "./commands/login.js";
import { syncCmd } from "./commands/sync.js";
import { statusCmd } from "./commands/status.js";
import { secretsListCmd, secretsSetCmd } from "./commands/secrets.js";
import { backupCmd } from "./commands/backup.js";
import { restoreCmd } from "./commands/restore.js";
import { installCmd, installGitCmd, type InstallOptions } from "./commands/install.js";
import {
  activateCmd,
  deactivateCmd,
  profileAddCmd,
  profileRemoveCmd,
  profileShowCmd,
} from "./commands/profile.js";

const program = new Command();

program
  .name("pier")
  .description("self-hosted MCP control plane — sync configs and secrets from your homelab")
  .version("0.1.5");

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
  .option("--explain", "print why each MCP was included/skipped", false)
  .option("--all", "skip profile/workspace filtering, include every MCP", false)
  .option("--workspace <path>", "override the workspace root (default: cwd)")
  .action(
    async (opts: {
      clients: string;
      dryRun: boolean;
      explain: boolean;
      all: boolean;
      workspace?: string;
    }) => {
      await syncCmd({
        clients: opts.clients.split(","),
        dryRun: opts.dryRun,
        explain: opts.explain,
        all: opts.all,
        workspace: opts.workspace,
      });
    },
  );

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
  .command("activate <name>")
  .description("pin an MCP to always-on in your user profile")
  .action(async (name: string) => {
    await activateCmd(name);
  });

program
  .command("deactivate <name>")
  .description("exclude an MCP via your user profile (wins over formula triggers)")
  .action(async (name: string) => {
    await deactivateCmd(name);
  });

const profile = program
  .command("profile")
  .description("manage the user profile at ~/.config/pier/profile.yaml");
profile
  .command("show")
  .description("show current user profile")
  .action(profileShowCmd);
profile
  .command("add <kind> <value>")
  .description("add an entry — kind is 'always', 'never', or 'include_tags'")
  .action(async (kind: string, value: string) => {
    await profileAddCmd(kind as "always" | "never" | "include_tags", value);
  });
profile
  .command("remove <kind> <value>")
  .description("remove an entry — kind is 'always', 'never', or 'include_tags'")
  .action(async (kind: string, value: string) => {
    await profileRemoveCmd(kind as "always" | "never" | "include_tags", value);
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
