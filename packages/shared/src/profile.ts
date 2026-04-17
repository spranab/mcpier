import { z } from "zod";

/**
 * User-global profile lives at ~/.config/pier/profile.yaml. Accumulates across
 * sessions via `pier activate` / `pier profile add|remove`. Priority-wins over
 * formula auto_activate hints but loses to workspace .pier.yaml.
 */
export const UserProfile = z.object({
  /** Always include these MCPs regardless of workspace triggers. */
  always: z.array(z.string()).default([]),
  /** Never include these MCPs, even if workspace triggers match. */
  never: z.array(z.string()).default([]),
  /** Include any MCP whose formula tags contain one of these. */
  include_tags: z.array(z.string()).default([]),
});
export type UserProfile = z.infer<typeof UserProfile>;

export const emptyUserProfile: UserProfile = {
  always: [],
  never: [],
  include_tags: [],
};

/**
 * Workspace-local config lives at .pier.yaml in any project root (searched
 * up the directory tree from cwd). Highest priority in the merge.
 */
export const WorkspaceConfig = z.object({
  /** Shorthand: "use this named user profile as the base." (Future.) */
  profile: z.string().optional(),
  /** Force-include these MCPs in this workspace. */
  include: z.array(z.string()).default([]),
  /** Force-exclude these MCPs in this workspace. */
  exclude: z.array(z.string()).default([]),
  /** Include any MCP whose formula tags contain one of these. */
  include_tags: z.array(z.string()).default([]),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>;

/** Reason an MCP was included in or excluded from a synced client config. */
export type ActivationReason =
  | { source: "workspace-include"; path: string }
  | { source: "workspace-exclude"; path: string }
  | { source: "workspace-tag"; path: string; tag: string }
  | { source: "user-always" }
  | { source: "user-never" }
  | { source: "user-tag"; tag: string }
  | { source: "auto-file"; path: string }
  | { source: "auto-glob"; pattern: string }
  | { source: "auto-always" }
  | { source: "auto-on-demand" }
  | { source: "no-match" };

export interface ActivationDecision {
  name: string;
  included: boolean;
  reason: ActivationReason;
}
