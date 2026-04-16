import type { CatalogEntry, Formula, SecretSpec } from "@mcpier/shared";

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0";
export const REGISTRY_URL_SCHEME = "mcp-registry://official";

interface RegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  format?: string;
  isSecret?: boolean;
}

interface RegistryPackage {
  registryType: "npm" | "pypi" | "oci" | "mcpb";
  identifier: string;
  version?: string;
  transport?: { type: "stdio" | "streamable-http" | "sse" };
  environmentVariables?: RegistryEnvVar[];
  runtimeArguments?: { type?: string; value?: string; name?: string }[];
  packageArguments?: { type?: string; value?: string; name?: string }[];
}

interface RegistryRemote {
  type: "streamable-http" | "sse" | "http";
  url: string;
  headers?: Record<string, string>;
}

interface RegistryServer {
  name: string;
  description?: string;
  title?: string;
  version?: string;
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
  repository?: { url?: string; source?: string };
}

interface RegistryItem {
  server: RegistryServer;
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: {
      status?: string;
      isLatest?: boolean;
    };
  };
}

interface RegistryPage {
  servers: RegistryItem[];
  metadata?: { nextCursor?: string; count?: number };
}

function ownerFromNamespace(name: string): { namespace: string; owner: string } | null {
  const slash = name.indexOf("/");
  if (slash === -1) return null;
  const namespace = name.slice(0, slash);
  const parts = namespace.split(".");
  if (parts.length < 2) return { namespace, owner: namespace };
  if (parts[0] === "io" && parts[1] === "github" && parts[2]) {
    return { namespace, owner: `github:${parts[2]}` };
  }
  return { namespace, owner: parts.slice(1).reverse().join(".") };
}

function shortName(registryName: string): string {
  const slash = registryName.indexOf("/");
  const base = slash === -1 ? registryName : registryName.slice(slash + 1);
  return base.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function pickPackage(pkgs: RegistryPackage[] | undefined): RegistryPackage | null {
  if (!pkgs || pkgs.length === 0) return null;
  return (
    pkgs.find((p) => p.registryType === "npm") ??
    pkgs.find((p) => p.registryType === "pypi") ??
    pkgs[0]!
  );
}

function registryEnvToSecret(ev: RegistryEnvVar): SecretSpec | null {
  if (!ev.isRequired && !ev.isSecret) return null;
  const key = ev.name.toLowerCase();
  return {
    key,
    label: ev.description || ev.name,
    required: !!ev.isRequired,
  };
}

function envMapping(
  envs: RegistryEnvVar[] | undefined,
): { env: Record<string, string>; secrets: SecretSpec[] } {
  const env: Record<string, string> = {};
  const secrets: SecretSpec[] = [];
  for (const ev of envs ?? []) {
    const s = registryEnvToSecret(ev);
    if (s) {
      secrets.push(s);
      env[ev.name] = `\${${s.key}}`;
    }
  }
  return { env, secrets };
}

function toFormula(server: RegistryServer, tags: string[]): Formula | null {
  const pkg = pickPackage(server.packages);
  if (pkg) {
    const transport = pkg.transport?.type ?? "stdio";
    if (transport !== "stdio") return null;
    const { env, secrets } = envMapping(pkg.environmentVariables);
    const runtime =
      pkg.registryType === "npm"
        ? "node"
        : pkg.registryType === "pypi"
          ? "python"
          : "binary";
    const extraArgs = (pkg.runtimeArguments ?? [])
      .concat(pkg.packageArguments ?? [])
      .map((a) => a.value ?? a.name ?? "")
      .filter(Boolean);
    return {
      name: shortName(server.name),
      description: server.description ?? "",
      tags,
      transport: "stdio",
      runtime,
      package: pkg.identifier,
      args: extraArgs,
      env,
      secrets,
      remote_eligible: true,
      ...(server.repository?.url ? { homepage: server.repository.url } : {}),
    } as Formula;
  }
  const remote = server.remotes?.find(
    (r) => r.type === "streamable-http" || r.type === "sse" || r.type === "http",
  );
  if (remote) {
    const transport = remote.type === "streamable-http" ? "http" : remote.type;
    return {
      name: shortName(server.name),
      description: server.description ?? "",
      tags,
      transport,
      url: remote.url,
      headers: remote.headers ?? {},
      secrets: [],
      remote_eligible: true,
      ...(server.repository?.url ? { homepage: server.repository.url } : {}),
    } as Formula;
  }
  return null;
}

function toCatalogEntry(item: RegistryItem): CatalogEntry | null {
  const status = item._meta?.["io.modelcontextprotocol.registry/official"];
  if (status && status.status !== "active") return null;
  if (status && status.isLatest === false) return null;
  const server = item.server;
  if (!server?.name) return null;

  const auth = ownerFromNamespace(server.name);
  const tags: string[] = ["registry"];
  const firstPkg = pickPackage(server.packages);
  if (firstPkg) {
    tags.push(firstPkg.registryType);
    if (firstPkg.registryType === "npm") tags.push("node");
    if (firstPkg.registryType === "pypi") tags.push("python");
  } else if (server.remotes && server.remotes.length > 0) {
    tags.push("remote");
  }
  if (auth) tags.push(auth.owner.startsWith("github:") ? auth.owner.slice(7) : auth.owner);

  const formula = toFormula(server, tags);
  if (!formula) return null;

  return {
    name: server.name,
    source: server.repository?.url
      ? server.repository.url
      : `mcp-registry://${server.name}`,
    description: server.description ?? "",
    tags,
    homepage: server.repository?.url,
    verified: true,
    formula,
    ...(auth ? { authority: auth } : {}),
  } as CatalogEntry;
}

export async function fetchRegistry(opts: { maxPages?: number; pageSize?: number } = {}): Promise<
  CatalogEntry[]
> {
  const maxPages = opts.maxPages ?? 2;
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const url = new URL(`${REGISTRY_BASE}/servers`);
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`registry ${res.status} ${res.statusText}`);
    const page = (await res.json()) as RegistryPage;
    for (const item of page.servers ?? []) {
      const entry = toCatalogEntry(item);
      if (!entry) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      out.push(entry);
    }
    cursor = page.metadata?.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export async function searchRegistry(query: string, limit = 50): Promise<CatalogEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL(`${REGISTRY_BASE}/servers`);
  url.searchParams.set("search", q);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 100)));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`registry search ${res.status} ${res.statusText}`);
  const page = (await res.json()) as RegistryPage;
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const item of page.servers ?? []) {
    const entry = toCatalogEntry(item);
    if (!entry) continue;
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
  }
  return out;
}
