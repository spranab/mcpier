import type { Formula, InstallRequest, Manifest } from "@mcpier/shared";

export interface CatalogSource {
  url: string;
  name: string;
  verified: boolean;
  enabled: boolean;
  error?: string;
  entries: {
    name: string;
    source: string;
    description: string;
    tags: string[];
    homepage?: string;
    verified: boolean;
    formula_url?: string;
    formula?: unknown;
    authority?: { namespace: string; owner: string };
  }[];
  fetched_at: number;
}

export interface CatalogSubscription {
  name: string;
  url: string;
  enabled: boolean;
  added_at: number;
}

const TOKEN_KEY = "pier.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ status: string; version: string }>("/health"),
  getManifest: () => req<{ manifest: Manifest; etag: string }>("/api/manifest"),
  putManifest: (manifest: Manifest) =>
    req<{ etag: string }>("/api/manifest", {
      method: "PUT",
      body: JSON.stringify(manifest),
    }),
  listSecrets: () => req<{ keys: string[] }>("/api/secrets"),
  setSecret: (key: string, value: string) =>
    req<{ ok: boolean }>("/api/secrets", {
      method: "PUT",
      body: JSON.stringify({ key, value }),
    }),
  deleteSecret: (key: string) =>
    req<{ removed: boolean }>(`/api/secrets/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),
  getCatalog: () => req<{ sources: CatalogSource[] }>("/api/catalog"),
  refreshCatalog: () =>
    req<{ sources: CatalogSource[] }>("/api/catalog/refresh", { method: "POST" }),
  searchRegistry: (q: string) =>
    req<{ entries: CatalogSource["entries"] }>(
      `/api/catalog/search?q=${encodeURIComponent(q)}`,
    ),
  resolveFormula: (body: { source?: string; formula_url?: string }) =>
    req<{ formula: Formula }>("/api/catalog/formula", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  install: (body: InstallRequest) =>
    req<{ ok: boolean; entry_name: string }>("/api/install", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uninstall: (name: string) =>
    req<{ ok: boolean }>(`/api/install/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  getStatus: () =>
    req<{ spawned: Record<string, { session_count: number; pids: number[] }> }>(
      "/api/status",
    ),
  listCatalogs: () => req<{ subscriptions: CatalogSubscription[] }>("/api/catalogs"),
  addCatalog: (body: { url: string; name?: string }) =>
    req<{ subscription: CatalogSubscription; source: CatalogSource | null }>(
      "/api/catalogs",
      { method: "POST", body: JSON.stringify(body) },
    ),
  removeCatalog: (name: string) =>
    req<{ removed: boolean }>(`/api/catalogs/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  refreshCatalogOne: (name: string) =>
    req<{ source: CatalogSource }>(
      `/api/catalogs/${encodeURIComponent(name)}/refresh`,
      { method: "POST" },
    ),
  toggleCatalog: (name: string, enabled: boolean) =>
    req<{ ok: boolean }>(`/api/catalogs/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};
