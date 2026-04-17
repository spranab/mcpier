import kleur from "kleur";
import type { Manifest } from "@mcpier/shared";
import { ClientKind } from "@mcpier/shared";
import { PierClient } from "../client.js";
import { loadLocalConfig } from "../config.js";
import { renderManifest, writeClient } from "../writers.js";
import {
  explainReason,
  findWorkspaceConfig,
  loadUserProfile,
  resolve as resolveActivations,
} from "../activation.js";

export interface SyncOptions {
  clients: string[];
  dryRun: boolean;
  explain: boolean;
  /** Disable profile/workspace filtering (include every manifest entry). */
  all: boolean;
  /** Override cwd for workspace config lookup (defaults to process.cwd()). */
  workspace?: string;
}

export async function syncCmd(opts: SyncOptions): Promise<void> {
  const cfg = loadLocalConfig();
  const client = new PierClient(cfg);
  const cwd = opts.workspace ?? process.cwd();

  console.log(kleur.gray(`pulling manifest from ${cfg.server}…`));
  const { manifest } = await client.getManifest();

  // Filter manifest through profile + workspace + formula triggers.
  let filteredManifest = manifest;
  if (!opts.all) {
    filteredManifest = filterManifest(manifest, cwd, opts.explain);
  } else if (opts.explain) {
    console.log(kleur.gray("(--all: skipping activation filter; every entry included)"));
  }

  const neededSecrets = new Set<string>();
  for (const entry of Object.values(filteredManifest.servers)) {
    for (const k of entry.secrets) neededSecrets.add(k);
  }

  console.log(kleur.gray(`fetching ${neededSecrets.size} secret(s)…`));
  const { secrets } = neededSecrets.size
    ? await client.fetchSecrets([...neededSecrets])
    : { secrets: {} };

  const missing = [...neededSecrets].filter((k) => !(k in secrets));
  if (missing.length > 0) {
    console.warn(kleur.yellow(`! missing secrets on server: ${missing.join(", ")}`));
  }

  const rendered = renderManifest(filteredManifest, secrets, {
    pierServer: cfg.server,
    pierToken: cfg.token,
  });
  const clients = opts.clients.map((c) => ClientKind.parse(c));

  if (opts.dryRun) {
    console.log(kleur.cyan("\n--- dry run: rendered config ---"));
    console.log(JSON.stringify(rendered, null, 2));
    console.log(kleur.cyan(`would write to clients: ${clients.join(", ")}`));
    return;
  }

  for (const kind of clients) {
    const res = writeClient(kind, rendered);
    console.log(
      kleur.green("✓"),
      res.client,
      kleur.gray("→"),
      res.path,
      kleur.gray(`(${res.serverCount} servers)`),
    );
  }
}

function filterManifest(manifest: Manifest, cwd: string, explain: boolean): Manifest {
  const profile = loadUserProfile();
  const workspaceHit = findWorkspaceConfig(cwd);
  const decisions = resolveActivations({
    cwd,
    manifest,
    profile,
    workspace: workspaceHit?.config,
  });

  if (explain) {
    console.log(kleur.cyan(`\n--- activation trace (cwd: ${cwd}) ---`));
    if (workspaceHit) {
      console.log(kleur.gray(`  workspace: ${workspaceHit.path}`));
    } else {
      console.log(kleur.gray("  workspace: (no .pier.yaml found in ancestors)"));
    }
    const wMax = Math.max(...decisions.map((d) => d.name.length), 10);
    for (const d of decisions) {
      const tag = d.included ? kleur.green("✓") : kleur.gray("·");
      const state = d.included ? kleur.green("include") : kleur.gray("skip   ");
      console.log(`  ${tag} ${d.name.padEnd(wMax)}  ${state}  ${kleur.gray(explainReason(d.reason))}`);
    }
    console.log();
  }

  const included = new Set(decisions.filter((d) => d.included).map((d) => d.name));
  const servers: Manifest["servers"] = {};
  for (const [name, entry] of Object.entries(manifest.servers)) {
    if (included.has(name)) servers[name] = entry;
  }
  return { version: 1, servers };
}
