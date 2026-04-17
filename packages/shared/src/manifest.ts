import { z } from "zod";

export const Location = z.enum(["local", "remote"]).default("local");
export type Location = z.infer<typeof Location>;

// Duplicated here (not imported from catalog.ts) to avoid a cycle:
// catalog.ts already imports from manifest.ts.
const ActivationTriggerEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("glob"), pattern: z.string() }),
  z.object({ kind: z.literal("always") }),
  z.object({ kind: z.literal("on_demand") }),
]);

const AutoActivateEntry = z.object({
  triggers: z.array(ActivationTriggerEntry).default([]),
});

const serverEntryCommon = {
  tags: z.array(z.string()).default([]),
  auto_activate: AutoActivateEntry.optional(),
};

export const StdioServer = z.object({
  transport: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  secrets: z.array(z.string()).default([]),
  location: Location,
  ...serverEntryCommon,
});

export const HttpServer = z.object({
  transport: z.enum(["http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
  secrets: z.array(z.string()).default([]),
  location: Location,
  ...serverEntryCommon,
});

export const ServerEntry = z.discriminatedUnion("transport", [
  StdioServer,
  HttpServer,
]);

export const Manifest = z.object({
  version: z.literal(1),
  servers: z.record(ServerEntry),
});

export type Manifest = z.infer<typeof Manifest>;
export type ServerEntry = z.infer<typeof ServerEntry>;
export type StdioServer = z.infer<typeof StdioServer>;
export type HttpServer = z.infer<typeof HttpServer>;

export const ClientKind = z.enum([
  "claude-code",
  "claude-desktop",
  "cursor",
  "continue",
  "codex",
  "windsurf",
]);
export type ClientKind = z.infer<typeof ClientKind>;
