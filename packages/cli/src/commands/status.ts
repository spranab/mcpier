import kleur from "kleur";
import { PierClient } from "../client.js";
import { loadLocalConfig } from "../config.js";

export async function statusCmd(): Promise<void> {
  const cfg = loadLocalConfig();
  const client = new PierClient(cfg);
  const [health, manifest, secretKeys] = await Promise.all([
    client.health(),
    client.getManifest(),
    client.listSecrets(),
  ]);
  console.log(kleur.bold("server:   "), cfg.server);
  console.log(kleur.bold("status:   "), health.status, kleur.gray(`(v${health.version})`));
  console.log(kleur.bold("servers:  "), Object.keys(manifest.manifest.servers).length);
  console.log(kleur.bold("secrets:  "), secretKeys.keys.length);
  console.log(kleur.bold("etag:     "), kleur.gray(manifest.etag));
  console.log();
  for (const [name, entry] of Object.entries(manifest.manifest.servers)) {
    const transport = kleur.magenta(entry.transport);
    const needs = entry.secrets.length
      ? kleur.gray(` [secrets: ${entry.secrets.join(", ")}]`)
      : "";
    console.log(`  ${name.padEnd(20)} ${transport}${needs}`);
  }
}
