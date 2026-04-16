import { writeFileSync } from "node:fs";
import kleur from "kleur";
import { PierClient } from "../client.js";
import { loadLocalConfig } from "../config.js";

export async function backupCmd(opts: { output?: string }): Promise<void> {
  const cfg = loadLocalConfig();
  const client = new PierClient(cfg);
  const raw = await client.backupRaw();
  const size = Buffer.byteLength(raw, "utf8");

  if (!opts.output) {
    process.stdout.write(raw);
    return;
  }

  writeFileSync(opts.output, raw);
  console.log(kleur.green("✓"), "wrote", opts.output, kleur.gray(`(${prettySize(size)})`));
  console.log();
  console.log(kleur.gray("To restore on a fresh Pier with the SAME master key:"));
  console.log(kleur.gray("  1. stop the Pier server"));
  console.log(kleur.gray("  2. jq -r '.pier_db_b64' backup.json | base64 -d > pier.db"));
  console.log(kleur.gray("  3. jq '.manifest' backup.json | yq -p json -o yaml > manifest.yaml"));
  console.log(kleur.gray("  4. copy both into PIER_DATA_DIR and start Pier"));
}

function prettySize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
