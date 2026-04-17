import { z } from "zod";

export const SecretSpec = z.object({
  key: z.string().min(1),
  label: z.string(),
  help: z.string().url().optional(),
  required: z.boolean().default(true),
});
export type SecretSpec = z.infer<typeof SecretSpec>;

/**
 * Activation triggers (author-declared, ADVISORY). The MCP's pier.yaml says
 * when it's *probably* relevant; the user profile wins if it disagrees.
 *   file:     filesystem pattern evaluated against the workspace root
 *   glob:     glob pattern (e.g. "**\/*.sql") evaluated against cwd
 *   always:   always relevant (filesystem tool, reasoning helper)
 *   on_demand: never auto-activate; pier-hub only (default for specialty MCPs)
 */
export const ActivationTrigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("glob"), pattern: z.string() }),
  z.object({ kind: z.literal("always") }),
  z.object({ kind: z.literal("on_demand") }),
]);
export type ActivationTrigger = z.infer<typeof ActivationTrigger>;

export const AutoActivate = z.object({
  triggers: z.array(ActivationTrigger).default([]),
});
export type AutoActivate = z.infer<typeof AutoActivate>;

const FormulaBase = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  secrets: z.array(SecretSpec).default([]),
  remote_eligible: z.boolean().default(false),
  auto_activate: AutoActivate.optional(),
});

export const StdioFormula = FormulaBase.extend({
  transport: z.literal("stdio"),
  runtime: z.enum(["node", "python", "binary"]).default("node"),
  package: z.string().optional(),
  git: z.string().url().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
});

export const HttpFormula = FormulaBase.extend({
  transport: z.enum(["http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
});

export const Formula = z.discriminatedUnion("transport", [StdioFormula, HttpFormula]);
export type Formula = z.infer<typeof Formula>;
export type StdioFormula = z.infer<typeof StdioFormula>;
export type HttpFormula = z.infer<typeof HttpFormula>;

export const CatalogEntry = z.object({
  name: z.string(),
  source: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  verified: z.boolean().default(false),
  formula_url: z.string().url().optional(),
  /** Inline formula, used by synthetic sources (e.g. the MCP Registry adapter). */
  formula: z.any().optional(),
  /** Authority signal from namespace-verified sources. */
  authority: z
    .object({
      namespace: z.string(),
      owner: z.string(),
    })
    .optional(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const Catalog = z.object({
  name: z.string(),
  version: z.literal(1),
  updated: z.string().optional(),
  entries: z.array(CatalogEntry),
});
export type Catalog = z.infer<typeof Catalog>;

export const InstallRequest = z.object({
  install_name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "name must be lowercase, digits, hyphens, underscores"),
  formula: Formula,
  secrets: z.record(z.string()),
  location: z.enum(["local", "remote"]).default("local"),
});
export type InstallRequest = z.infer<typeof InstallRequest>;
