import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import kleur from "kleur";
import YAML from "yaml";
import { UserProfile, emptyUserProfile } from "@mcpier/shared";
import { userProfilePath } from "../config.js";

function load(): UserProfile {
  const p = userProfilePath();
  if (!existsSync(p)) return { ...emptyUserProfile };
  try {
    const raw = readFileSync(p, "utf8");
    return UserProfile.parse(YAML.parse(raw) ?? {});
  } catch (err) {
    throw new Error(`could not parse ${p}: ${(err as Error).message}`);
  }
}

function save(profile: UserProfile): void {
  const p = userProfilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(
    p,
    `# Pier user profile — edited by \`pier profile\` / \`pier activate\`.\n# Priority in pier sync: workspace .pier.yaml > this > formula auto_activate.\n${YAML.stringify(profile)}`,
  );
}

function sortedUnique(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

export async function profileShowCmd(): Promise<void> {
  const profile = load();
  const p = userProfilePath();
  console.log(kleur.gray(`file: ${p}`));
  console.log();
  console.log(kleur.bold("always:      "), profile.always.length ? profile.always.join(", ") : kleur.gray("(none)"));
  console.log(kleur.bold("never:       "), profile.never.length ? profile.never.join(", ") : kleur.gray("(none)"));
  console.log(kleur.bold("include_tags:"), profile.include_tags.length ? profile.include_tags.join(", ") : kleur.gray("(none)"));
}

export async function profileAddCmd(
  kind: "always" | "never" | "include_tags",
  value: string,
): Promise<void> {
  const profile = load();
  profile[kind] = sortedUnique([...profile[kind], value]);
  save(profile);
  console.log(kleur.green("✓ added"), kleur.cyan(value), kleur.gray(`to ${kind}`));
}

export async function profileRemoveCmd(
  kind: "always" | "never" | "include_tags",
  value: string,
): Promise<void> {
  const profile = load();
  const before = profile[kind].length;
  profile[kind] = profile[kind].filter((x) => x !== value);
  if (profile[kind].length === before) {
    console.log(kleur.gray(`(${value} was not in ${kind}; no change)`));
    return;
  }
  save(profile);
  console.log(kleur.green("✓ removed"), kleur.cyan(value), kleur.gray(`from ${kind}`));
}

export async function activateCmd(name: string): Promise<void> {
  const profile = load();
  if (profile.always.includes(name)) {
    console.log(kleur.gray(`${name} is already in always[]`));
    return;
  }
  profile.never = profile.never.filter((x) => x !== name);
  profile.always = sortedUnique([...profile.always, name]);
  save(profile);
  console.log(
    kleur.green("✓"),
    "added",
    kleur.cyan(name),
    kleur.gray("to user profile always[] — run `pier sync` on each client to pick it up."),
  );
}

export async function deactivateCmd(name: string): Promise<void> {
  const profile = load();
  if (profile.never.includes(name)) {
    console.log(kleur.gray(`${name} is already in never[]`));
    return;
  }
  profile.always = profile.always.filter((x) => x !== name);
  profile.never = sortedUnique([...profile.never, name]);
  save(profile);
  console.log(
    kleur.green("✓"),
    "added",
    kleur.cyan(name),
    kleur.gray("to user profile never[] — will be filtered out on next sync."),
  );
}
