import YAML from "yaml";
import { Catalog, CatalogEntry, Formula } from "@mcpier/shared";

export interface CatalogSource {
  name: string;
  url: string;
  verified: boolean;
  enabled: boolean;
  error?: string;
  entries: CatalogEntry[];
  fetched_at: number;
}

export interface SubscriptionProvider {
  list(): { name: string; url: string; enabled: boolean }[];
}

export class CatalogCache {
  private sources: Map<string, CatalogSource> = new Map();

  constructor(
    private provider: SubscriptionProvider,
    private ttlMs: number,
  ) {}

  async ensureFresh(): Promise<CatalogSource[]> {
    const subs = this.provider.list();
    this.pruneRemoved(subs);
    const now = Date.now();
    await Promise.all(
      subs.filter((s) => s.enabled).map(async (sub) => {
        const existing = this.sources.get(sub.name);
        if (existing && now - existing.fetched_at < this.ttlMs) return;
        await this.fetchOne(sub.name, sub.url, true);
      }),
    );
    for (const sub of subs.filter((s) => !s.enabled)) {
      this.sources.set(sub.name, {
        name: sub.name,
        url: sub.url,
        verified: false,
        enabled: false,
        entries: [],
        fetched_at: Date.now(),
      });
    }
    return this.orderedByProvider(subs);
  }

  async forceRefresh(): Promise<CatalogSource[]> {
    const subs = this.provider.list();
    this.pruneRemoved(subs);
    await Promise.all(
      subs.filter((s) => s.enabled).map((s) => this.fetchOne(s.name, s.url, true)),
    );
    return this.orderedByProvider(subs);
  }

  async refreshOne(name: string): Promise<CatalogSource | null> {
    const sub = this.provider.list().find((s) => s.name === name);
    if (!sub) return null;
    await this.fetchOne(sub.name, sub.url, true);
    return this.sources.get(sub.name) ?? null;
  }

  forget(name: string): void {
    this.sources.delete(name);
  }

  private pruneRemoved(subs: { name: string }[]): void {
    const names = new Set(subs.map((s) => s.name));
    for (const key of [...this.sources.keys()]) {
      if (!names.has(key)) this.sources.delete(key);
    }
  }

  private orderedByProvider(
    subs: { name: string; url: string; enabled: boolean }[],
  ): CatalogSource[] {
    return subs
      .map((sub) => this.sources.get(sub.name))
      .filter((s): s is CatalogSource => s !== undefined);
  }

  private async fetchOne(name: string, url: string, enabled: boolean): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const parsed = Catalog.parse(data);
      this.sources.set(name, {
        name,
        url,
        verified: true,
        enabled,
        entries: parsed.entries,
        fetched_at: Date.now(),
      });
    } catch (err) {
      this.sources.set(name, {
        name,
        url,
        verified: false,
        enabled,
        error: (err as Error).message,
        entries: [],
        fetched_at: Date.now(),
      });
    }
  }
}

export async function resolveFormula(entry: CatalogEntry): Promise<Formula> {
  const url = entry.formula_url ?? inferFormulaUrl(entry.source);
  if (!url) throw new Error(`cannot resolve formula for ${entry.name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch formula ${url}: ${res.status}`);
  const raw = await res.text();
  const data = raw.trim().startsWith("{") ? JSON.parse(raw) : YAML.parse(raw);
  return Formula.parse(data);
}

function inferFormulaUrl(source: string): string | null {
  const m = source.match(/^github:([^/]+)\/([^/]+)(?::(.+))?$/);
  if (!m) return null;
  const [, owner, repo, ref] = m;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? "main"}/pier.yaml`;
}

export async function fetchFormulaFromUrl(url: string): Promise<Formula> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const raw = await res.text();
  const data = raw.trim().startsWith("{") ? JSON.parse(raw) : YAML.parse(raw);
  return Formula.parse(data);
}
