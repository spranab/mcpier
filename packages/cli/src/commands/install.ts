import { password, select, confirm } from "@inquirer/prompts";
import kleur from "kleur";
import type { Formula, InstallRequest } from "@mcpier/shared";
import { PierClient, type CatalogEntrySummary } from "../client.js";
import { loadLocalConfig } from "../config.js";
import { syncCmd } from "./sync.js";

export interface InstallOptions {
  /** Pre-set secret values, e.g. ["openai_key=sk-...", "gemini_key=..."]. Bypasses prompts. */
  set: string[];
  /** 'local' or 'remote'. If omitted, prompted (default: remote if eligible, else local). */
  location?: "local" | "remote";
  /** Install name (defaults to formula.name). */
  as?: string;
  /** Disable interactive prompts; fail if a required secret isn't provided via --set. */
  nonInteractive: boolean;
  /** Run pier sync after install for these clients (comma-separated). */
  sync?: string;
  /** Narrow catalog search to one source (e.g. "mcp-registry"). */
  source?: string;
}

function parseSetFlags(flags: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of flags) {
    const eq = f.indexOf("=");
    if (eq === -1) throw new Error(`invalid --set value: ${f} (expected key=value)`);
    out[f.slice(0, eq).trim()] = f.slice(eq + 1);
  }
  return out;
}

async function resolveByName(
  client: PierClient,
  name: string,
  sourceFilter?: string,
): Promise<{ entry: CatalogEntrySummary; formula: Formula }> {
  const { sources } = await client.getCatalog();
  const matches: { source: string; entry: CatalogEntrySummary }[] = [];
  for (const s of sources) {
    if (!s.enabled || !s.verified) continue;
    if (sourceFilter && s.name !== sourceFilter) continue;
    for (const e of s.entries) {
      if (e.name === name || e.name.endsWith(`/${name}`)) {
        matches.push({ source: s.name, entry: e });
      }
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `no entry named '${name}'${sourceFilter ? ` in catalog '${sourceFilter}'` : ""}`,
    );
  }
  let picked = matches[0]!;
  if (matches.length > 1) {
    const choice = await select({
      message: `multiple catalogs have '${name}' — pick one:`,
      choices: matches.map((m) => ({
        name: `${m.source} → ${m.entry.name}`,
        value: m,
      })),
    });
    picked = choice;
  }
  const formula = picked.entry.formula
    ? (picked.entry.formula as Formula)
    : (
        await client.resolveFormula({
          source: picked.entry.formula_url ? undefined : picked.entry.source,
          formula_url: picked.entry.formula_url,
        })
      ).formula;
  return { entry: picked.entry, formula };
}

async function resolveByUrl(
  client: PierClient,
  url: string,
): Promise<{ formula: Formula }> {
  const formula_url = normaliseGitToFormulaUrl(url);
  return client.resolveFormula({ formula_url });
}

function normaliseGitToFormulaUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.endsWith(".yaml") || trimmed.endsWith(".yml") || trimmed.endsWith(".json")) {
    return trimmed;
  }
  const m = trimmed.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/pier.yaml`;
  }
  return trimmed.replace(/\/$/, "") + "/pier.yaml";
}

async function runInstall(
  client: PierClient,
  formula: Formula,
  opts: InstallOptions,
  source_label: string,
): Promise<void> {
  const install_name = opts.as ?? formula.name;
  const preset = parseSetFlags(opts.set);

  const remoteEligible = formula.remote_eligible && formula.transport !== "stdio"
    ? true
    : formula.remote_eligible && formula.transport === "stdio";
  let location: "local" | "remote";
  if (opts.location) location = opts.location;
  else if (opts.nonInteractive) location = formula.remote_eligible ? "remote" : "local";
  else {
    const chosen = await select({
      message: "Where should this run?",
      default: formula.remote_eligible ? "remote" : "local",
      choices: [
        {
          name: "local (spawn on each client machine)",
          value: "local" as const,
          description: "secrets get injected on every client; good for fs/browser tools",
        },
        {
          name: `remote (spawn once on pier)${
            remoteEligible ? "" : " — formula does not declare remote_eligible"
          }`,
          value: "remote" as const,
          description: "one URL entry in the client; secrets never leave pier",
        },
      ],
    });
    location = chosen;
  }

  const secrets: Record<string, string> = {};
  for (const spec of formula.secrets ?? []) {
    if (preset[spec.key] !== undefined) {
      secrets[spec.key] = preset[spec.key]!;
      continue;
    }
    if (opts.nonInteractive) {
      if (spec.required) {
        throw new Error(
          `required secret '${spec.key}' not provided (use --set ${spec.key}=<value>)`,
        );
      }
      continue;
    }
    const value = await password({
      message: spec.help
        ? `${spec.label} (${spec.help}):`
        : `${spec.label}:`,
      mask: "*",
      validate: (v) => (spec.required && !v ? `${spec.label} is required` : true),
    });
    if (value) secrets[spec.key] = value;
  }

  console.log(kleur.gray(`\ninstalling '${install_name}' from ${source_label}…`));
  const body: InstallRequest = { install_name, formula, secrets, location };
  const result = await client.install(body);
  console.log(kleur.green("✓ installed"), `'${result.entry_name}'`, kleur.gray(`(location: ${location})`));

  if (opts.sync) {
    console.log(kleur.gray(`\nsyncing to clients: ${opts.sync}`));
    await syncCmd({
      clients: opts.sync.split(","),
      dryRun: false,
      explain: false,
      all: false,
    });
  } else {
    console.log(
      kleur.gray(`\nnext: run`),
      kleur.cyan("pier sync"),
      kleur.gray("on each client machine to pick this up."),
    );
  }
}

export async function installCmd(name: string, opts: InstallOptions): Promise<void> {
  const client = new PierClient(loadLocalConfig());
  const { entry, formula } = await resolveByName(client, name, opts.source);
  await runInstall(client, formula, opts, entry.source);
}

export async function installGitCmd(url: string, opts: InstallOptions): Promise<void> {
  const client = new PierClient(loadLocalConfig());
  if (!opts.nonInteractive) {
    const ok = await confirm({
      message: `install from ${url}? this formula is NOT verified by any catalog.`,
      default: false,
    });
    if (!ok) {
      console.log(kleur.gray("aborted."));
      return;
    }
  }
  const { formula } = await resolveByUrl(client, url);
  await runInstall(client, formula, opts, url);
}
