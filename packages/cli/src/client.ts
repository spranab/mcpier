import type { Formula, InstallRequest, Manifest } from "@mcpier/shared";
import type { LocalConfig } from "./config.js";

export interface CatalogEntrySummary {
  name: string;
  source: string;
  description: string;
  tags: string[];
  verified: boolean;
  formula_url?: string;
  formula?: Formula;
  authority?: { namespace: string; owner: string };
}

export interface CatalogSourceSummary {
  name: string;
  url: string;
  verified: boolean;
  enabled: boolean;
  error?: string;
  entries: CatalogEntrySummary[];
}

export class PierClient {
  constructor(private cfg: LocalConfig) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.cfg.server}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.token}`,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
    }
    return res.json() as Promise<T>;
  }

  health(): Promise<{ status: string; version: string }> {
    return this.req("/health");
  }

  getManifest(): Promise<{ manifest: Manifest; etag: string }> {
    return this.req("/api/manifest");
  }

  fetchSecrets(keys: string[]): Promise<{ secrets: Record<string, string> }> {
    return this.req("/api/secrets/fetch", {
      method: "POST",
      body: JSON.stringify({ keys }),
    });
  }

  listSecrets(): Promise<{ keys: string[] }> {
    return this.req("/api/secrets");
  }

  setSecret(key: string, value: string): Promise<{ ok: boolean }> {
    return this.req("/api/secrets", {
      method: "PUT",
      body: JSON.stringify({ key, value }),
    });
  }

  async backupRaw(): Promise<string> {
    const res = await fetch(`${this.cfg.server}/api/backup`, {
      headers: { Authorization: `Bearer ${this.cfg.token}` },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`);
    }
    return res.text();
  }

  async restore(bundleJson: string): Promise<{ ok: boolean; restored_servers: number }> {
    const res = await fetch(`${this.cfg.server}/api/restore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.token}`,
      },
      body: bundleJson,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; restored_servers?: number };
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${data.error ?? ""}`);
    }
    return { ok: data.ok ?? false, restored_servers: data.restored_servers ?? 0 };
  }

  getCatalog(): Promise<{ sources: CatalogSourceSummary[] }> {
    return this.req("/api/catalog");
  }

  searchRegistry(q: string): Promise<{ entries: CatalogEntrySummary[] }> {
    return this.req(`/api/catalog/search?q=${encodeURIComponent(q)}`);
  }

  resolveFormula(body: { source?: string; formula_url?: string }): Promise<{ formula: Formula }> {
    return this.req("/api/catalog/formula", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  install(body: InstallRequest): Promise<{ ok: boolean; entry_name: string }> {
    return this.req("/api/install", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
