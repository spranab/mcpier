import kleur from "kleur";
import { PierClient } from "../client.js";
import { saveLocalConfig } from "../config.js";

export async function loginCmd(server: string, opts: { token: string }): Promise<void> {
  const cfg = { server: server.replace(/\/$/, ""), token: opts.token };
  const client = new PierClient(cfg);
  try {
    const h = await client.health();
    if (h.status !== "ok") throw new Error(`unexpected status: ${h.status}`);
  } catch (err) {
    console.error(kleur.red("✗ could not reach server:"), (err as Error).message);
    process.exit(1);
  }
  saveLocalConfig(cfg);
  console.log(kleur.green("✓ logged in to"), cfg.server);
}
