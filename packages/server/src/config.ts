import { readFileSync } from "node:fs";
import { z } from "zod";

const Env = z.object({
  PIER_PORT: z.coerce.number().default(8420),
  PIER_HOST: z.string().default("0.0.0.0"),
  PIER_DATA_DIR: z.string().default("./data"),
  PIER_MANIFEST_PATH: z.string().default("./manifest.yaml"),
  PIER_MASTER_KEY: z.string().optional(),
  PIER_MASTER_KEY_FILE: z.string().optional(),
  PIER_TOKENS: z.string().default(""),
  PIER_UI_DIR: z.string().optional(),
  PIER_CATALOG_URLS: z
    .string()
    .default(
      "https://raw.githubusercontent.com/spranab/mcpier-catalog/main/catalog.json",
    ),
  PIER_CATALOG_TTL_SECONDS: z.coerce.number().default(900),
  /**
   * Default per-spawned-MCP memory cap in megabytes. Applied via `prlimit`
   * on Linux; logs a warning and is skipped on other platforms. Set 0 to
   * disable.
   */
  PIER_SPAWN_MEMORY_MB: z.coerce.number().default(512),
});

export type Config = z.infer<typeof Env> & {
  tokens: Set<string>;
  catalogUrls: string[];
  masterKey: string;
};

function resolveMasterKey(parsed: z.infer<typeof Env>): string {
  if (parsed.PIER_MASTER_KEY_FILE) {
    const raw = readFileSync(parsed.PIER_MASTER_KEY_FILE, "utf8").trim();
    if (raw.length < 32) {
      throw new Error(
        `PIER_MASTER_KEY_FILE=${parsed.PIER_MASTER_KEY_FILE}: contents must be >= 32 chars (32 bytes hex = 64 chars)`,
      );
    }
    return raw;
  }
  if (parsed.PIER_MASTER_KEY) {
    if (parsed.PIER_MASTER_KEY.length < 32) {
      throw new Error(
        "PIER_MASTER_KEY must be >= 32 chars (32 bytes hex = 64 chars)",
      );
    }
    return parsed.PIER_MASTER_KEY;
  }
  throw new Error(
    "set either PIER_MASTER_KEY or PIER_MASTER_KEY_FILE (preferred for container secrets)",
  );
}

export function loadConfig(): Config {
  const parsed = Env.parse(process.env);
  const tokens = new Set(
    parsed.PIER_TOKENS.split(",").map((t) => t.trim()).filter(Boolean),
  );
  const catalogUrls = parsed.PIER_CATALOG_URLS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const masterKey = resolveMasterKey(parsed);
  return { ...parsed, tokens, catalogUrls, masterKey };
}
