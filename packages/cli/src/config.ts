import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

const LocalConfig = z.object({
  server: z.string().url(),
  token: z.string().min(1),
});
export type LocalConfig = z.infer<typeof LocalConfig>;

export function configPath(): string {
  return join(homedir(), ".config", "pier", "config.json");
}

export function userProfilePath(): string {
  return join(homedir(), ".config", "pier", "profile.yaml");
}

/** Tracks which entries in each client config Pier is responsible for.
 * Anything NOT in this list is treated as user-owned and preserved through
 * `pier sync`. Keyed by client kind → list of entry names. */
export function managedEntriesPath(): string {
  return join(homedir(), ".config", "pier", "managed.json");
}

export function loadLocalConfig(): LocalConfig {
  const path = configPath();
  if (!existsSync(path)) {
    throw new Error(`Not logged in. Run: pier login <server> --token <token>`);
  }
  const raw = readFileSync(path, "utf8");
  return LocalConfig.parse(JSON.parse(raw));
}

export function saveLocalConfig(cfg: LocalConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}
