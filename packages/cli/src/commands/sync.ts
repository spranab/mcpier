import kleur from "kleur";
import { ClientKind } from "@mcpier/shared";
import { PierClient } from "../client.js";
import { loadLocalConfig } from "../config.js";
import { renderManifest, writeClient } from "../writers.js";

export async function syncCmd(opts: { clients: string[]; dryRun: boolean }): Promise<void> {
  const cfg = loadLocalConfig();
  const client = new PierClient(cfg);

  console.log(kleur.gray(`pulling manifest from ${cfg.server}…`));
  const { manifest } = await client.getManifest();

  const neededSecrets = new Set<string>();
  for (const entry of Object.values(manifest.servers)) {
    for (const k of entry.secrets) neededSecrets.add(k);
  }

  console.log(kleur.gray(`fetching ${neededSecrets.size} secret(s)…`));
  const { secrets } = await client.fetchSecrets([...neededSecrets]);

  const missing = [...neededSecrets].filter((k) => !(k in secrets));
  if (missing.length > 0) {
    console.warn(kleur.yellow(`! missing secrets on server: ${missing.join(", ")}`));
  }

  const rendered = renderManifest(manifest, secrets, {
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
    console.log(kleur.green("✓"), res.client, kleur.gray("→"), res.path, kleur.gray(`(${res.serverCount} servers)`));
  }
}
