import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import YAML from "yaml";
import {
  type ActivationDecision,
  type ActivationReason,
  type Manifest,
  type ServerEntry,
  UserProfile,
  WorkspaceConfig,
  emptyUserProfile,
} from "@mcpier/shared";
import { userProfilePath } from "./config.js";

export interface ResolveOptions {
  cwd: string;
  manifest: Manifest;
  profile?: UserProfile;
  workspace?: WorkspaceConfig;
}

/** Walk up from cwd looking for a .pier.yaml file. */
export function findWorkspaceConfig(cwd: string): { path: string; config: WorkspaceConfig } | null {
  let dir = resolvePath(cwd);
  while (true) {
    const p = join(dir, ".pier.yaml");
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      const data = YAML.parse(raw) ?? {};
      return { path: p, config: WorkspaceConfig.parse(data) };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadUserProfile(): UserProfile {
  const p = userProfilePath();
  if (!existsSync(p)) return emptyUserProfile;
  try {
    const raw = readFileSync(p, "utf8");
    return UserProfile.parse(YAML.parse(raw) ?? {});
  } catch {
    return emptyUserProfile;
  }
}

export function evaluateTrigger(
  entry: ServerEntry,
  cwd: string,
): { matched: boolean; reason: ActivationReason } {
  const triggers = entry.auto_activate?.triggers ?? [];
  if (triggers.length === 0) {
    return { matched: false, reason: { source: "auto-on-demand" } };
  }
  for (const t of triggers) {
    if (t.kind === "always") return { matched: true, reason: { source: "auto-always" } };
    if (t.kind === "on_demand")
      return { matched: false, reason: { source: "auto-on-demand" } };
    if (t.kind === "file") {
      const p = join(cwd, t.path);
      if (existsSync(p)) return { matched: true, reason: { source: "auto-file", path: t.path } };
    }
    if (t.kind === "glob") {
      if (firstGlobMatch(cwd, t.pattern)) {
        return { matched: true, reason: { source: "auto-glob", pattern: t.pattern } };
      }
    }
  }
  return { matched: false, reason: { source: "no-match" } };
}

/**
 * Priority-merge resolver. Returns a list of per-MCP decisions.
 *
 *   1. workspace .pier.yaml  (highest — include/exclude/include_tags)
 *   2. user profile          (always/never/include_tags)
 *   3. formula auto_activate (advisory, per manifest entry)
 *
 * user never[] always wins; workspace exclude[] wins over user always.
 */
export function resolve(opts: ResolveOptions): ActivationDecision[] {
  const profile = opts.profile ?? emptyUserProfile;
  const workspace = opts.workspace;
  const decisions: ActivationDecision[] = [];

  for (const [name, entry] of Object.entries(opts.manifest.servers)) {
    const tags = entry.tags ?? [];

    // Layer 1: workspace config wins.
    if (workspace) {
      if (workspace.exclude.includes(name)) {
        decisions.push({
          name,
          included: false,
          reason: { source: "workspace-exclude", path: ".pier.yaml" },
        });
        continue;
      }
      if (workspace.include.includes(name)) {
        decisions.push({
          name,
          included: true,
          reason: { source: "workspace-include", path: ".pier.yaml" },
        });
        continue;
      }
      const matchedTag = workspace.include_tags.find((t) => tags.includes(t));
      if (matchedTag) {
        decisions.push({
          name,
          included: true,
          reason: { source: "workspace-tag", path: ".pier.yaml", tag: matchedTag },
        });
        continue;
      }
    }

    // Layer 2: user profile.
    if (profile.never.includes(name)) {
      decisions.push({ name, included: false, reason: { source: "user-never" } });
      continue;
    }
    if (profile.always.includes(name)) {
      decisions.push({ name, included: true, reason: { source: "user-always" } });
      continue;
    }
    const userTag = profile.include_tags.find((t) => tags.includes(t));
    if (userTag) {
      decisions.push({ name, included: true, reason: { source: "user-tag", tag: userTag } });
      continue;
    }

    // Layer 3: formula advisory.
    const evalResult = evaluateTrigger(entry, opts.cwd);
    decisions.push({ name, included: evalResult.matched, reason: evalResult.reason });
  }

  return decisions;
}

export function explainReason(reason: ActivationReason): string {
  switch (reason.source) {
    case "workspace-include":
      return `workspace ${reason.path} include`;
    case "workspace-exclude":
      return `workspace ${reason.path} exclude`;
    case "workspace-tag":
      return `workspace ${reason.path} include_tags: ${reason.tag}`;
    case "user-always":
      return "user profile always[]";
    case "user-never":
      return "user profile never[]";
    case "user-tag":
      return `user profile include_tags: ${reason.tag}`;
    case "auto-file":
      return `auto-activate file: ${reason.path}`;
    case "auto-glob":
      return `auto-activate glob: ${reason.pattern}`;
    case "auto-always":
      return "auto-activate: always";
    case "auto-on-demand":
      return "auto-activate: on_demand (pier-hub only)";
    case "no-match":
      return "no trigger matched";
  }
}

/**
 * Tiny non-recursive glob-match for "**\/*.ext" style patterns — just enough
 * for what formulas actually declare. Full recursive glob can come later.
 */
function firstGlobMatch(root: string, pattern: string): boolean {
  if (!existsSync(root)) return false;
  if (!pattern.includes("*")) {
    return existsSync(join(root, pattern));
  }
  const m = pattern.match(/^\*\*\/\*\.([a-z0-9]+)$/i);
  if (m) {
    const ext = `.${m[1]!.toLowerCase()}`;
    return walkForExt(root, ext, 6);
  }
  // Fallback: treat as literal exists() check.
  return existsSync(join(root, pattern));
}

function walkForExt(dir: string, ext: string, depth: number): boolean {
  if (depth === 0) return false;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    const p = join(dir, e);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isFile() && e.toLowerCase().endsWith(ext)) return true;
    if (s.isDirectory() && walkForExt(p, ext, depth - 1)) return true;
  }
  return false;
}
