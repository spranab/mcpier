import kleur from "kleur";
import { PierClient } from "../client.js";
import { loadLocalConfig } from "../config.js";

export async function secretsListCmd(): Promise<void> {
  const client = new PierClient(loadLocalConfig());
  const { keys } = await client.listSecrets();
  if (keys.length === 0) {
    console.log(kleur.gray("no secrets stored"));
    return;
  }
  for (const k of keys) console.log(k);
}

export async function secretsSetCmd(key: string, value: string): Promise<void> {
  const client = new PierClient(loadLocalConfig());
  await client.setSecret(key, value);
  console.log(kleur.green("✓ set"), key);
}
