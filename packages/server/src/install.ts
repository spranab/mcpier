import type { Formula, Manifest, ServerEntry } from "@mcpier/shared";
import type { ManifestStore } from "./manifest.js";
import type { SecretStore } from "./db.js";

export interface InstallInput {
  install_name: string;
  formula: Formula;
  secrets: Record<string, string>;
  location: "local" | "remote";
}

export function installFromFormula(
  input: InstallInput,
  manifests: ManifestStore,
  store: SecretStore,
): { manifest: Manifest; entry_name: string } {
  const entry = formulaToEntry(input.formula, input.location);
  const current = manifests.current().manifest;
  const next: Manifest = {
    version: 1,
    servers: { ...current.servers, [input.install_name]: entry },
  };
  manifests.replace(next);

  for (const spec of input.formula.secrets) {
    const value = input.secrets[spec.key];
    if (value !== undefined && value !== "") {
      store.set(spec.key, value);
    }
  }
  return { manifest: next, entry_name: input.install_name };
}

export function uninstall(
  name: string,
  manifests: ManifestStore,
): { manifest: Manifest } {
  const current = manifests.current().manifest;
  const { [name]: _removed, ...rest } = current.servers;
  const next: Manifest = { version: 1, servers: rest };
  manifests.replace(next);
  return { manifest: next };
}

function formulaToEntry(formula: Formula, location: "local" | "remote"): ServerEntry {
  const common = {
    tags: formula.tags ?? [],
    ...(formula.auto_activate ? { auto_activate: formula.auto_activate } : {}),
  };
  if (formula.transport === "stdio") {
    const cmd = formula.command ?? defaultCommandForRuntime(formula);
    const args = formula.command ? formula.args : defaultArgsForRuntime(formula);
    return {
      transport: "stdio",
      command: cmd,
      args,
      env: formula.env,
      secrets: formula.secrets.map((s) => s.key),
      location,
      ...common,
    };
  }
  return {
    transport: formula.transport,
    url: formula.url,
    headers: formula.headers,
    secrets: formula.secrets.map((s) => s.key),
    location,
    ...common,
  };
}

function defaultCommandForRuntime(formula: {
  runtime: "node" | "python" | "binary";
  package?: string;
}): string {
  switch (formula.runtime) {
    case "node":
      return "npx";
    case "python":
      return "uvx";
    case "binary":
      return formula.package ?? "";
  }
}

function defaultArgsForRuntime(formula: {
  runtime: "node" | "python" | "binary";
  package?: string;
  args: string[];
}): string[] {
  if (!formula.package) return formula.args;
  switch (formula.runtime) {
    case "node":
      return ["-y", formula.package, ...formula.args];
    case "python":
      return [formula.package, ...formula.args];
    case "binary":
      return formula.args;
  }
}
