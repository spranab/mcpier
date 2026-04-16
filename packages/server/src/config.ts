import { z } from "zod";

const Env = z.object({
  PIER_PORT: z.coerce.number().default(8420),
  PIER_HOST: z.string().default("0.0.0.0"),
  PIER_DATA_DIR: z.string().default("./data"),
  PIER_MANIFEST_PATH: z.string().default("./manifest.yaml"),
  PIER_MASTER_KEY: z
    .string()
    .min(32, "PIER_MASTER_KEY must be at least 32 chars (32 bytes hex = 64 chars)"),
  PIER_TOKENS: z.string().default(""),
  PIER_UI_DIR: z.string().optional(),
  PIER_CATALOG_URLS: z
    .string()
    .default(
      "https://raw.githubusercontent.com/spranab/mcpier-catalog/main/catalog.json",
    ),
  PIER_CATALOG_TTL_SECONDS: z.coerce.number().default(900),
});

export type Config = z.infer<typeof Env> & {
  tokens: Set<string>;
  catalogUrls: string[];
};

export function loadConfig(): Config {
  const parsed = Env.parse(process.env);
  const tokens = new Set(
    parsed.PIER_TOKENS.split(",").map((t) => t.trim()).filter(Boolean),
  );
  const catalogUrls = parsed.PIER_CATALOG_URLS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { ...parsed, tokens, catalogUrls };
}
