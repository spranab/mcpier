import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Formula } from "@mcpier/shared";
import { api, type CatalogSource } from "./api.js";
import { InstallModal } from "./InstallModal.js";
import { SourcesPanel } from "./SourcesPanel.js";

export function BrowsePanel(): JSX.Element {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["catalog"], queryFn: () => api.getCatalog() });
  const refresh = useMutation({
    mutationFn: () => api.refreshCatalog(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });

  const [filter, setFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [pending, setPending] = useState<{
    entry_name: string;
    formula: Formula;
    source_label: string;
  } | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [gitError, setGitError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedFilter(filter.trim()), 350);
    return () => clearTimeout(id);
  }, [filter]);

  const registrySearch = useQuery({
    queryKey: ["registry-search", debouncedFilter],
    queryFn: () => api.searchRegistry(debouncedFilter),
    enabled: debouncedFilter.length >= 2,
    staleTime: 30_000,
  });

  const resolveMut = useMutation({
    mutationFn: (body: { source?: string; formula_url?: string }) =>
      api.resolveFormula(body),
  });

  const sources: CatalogSource[] = q.data?.sources ?? [];

  const filterEntries = (entries: CatalogSource["entries"]): CatalogSource["entries"] => {
    const f = filter.trim().toLowerCase();
    if (!f) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(f) ||
        e.description.toLowerCase().includes(f) ||
        e.tags.some((t) => t.toLowerCase().includes(f)),
    );
  };

  const totalCount = useMemo(
    () => sources.filter((s) => s.enabled).reduce((sum, s) => sum + filterEntries(s.entries).length, 0),
    [sources, filter],
  );

  async function openEntryInstall(entry: CatalogSource["entries"][number]): Promise<void> {
    if (entry.formula) {
      setPending({
        entry_name: entry.name,
        formula: entry.formula as Formula,
        source_label: entry.source,
      });
      return;
    }
    try {
      const { formula } = await resolveMut.mutateAsync({
        source: entry.formula_url ? undefined : entry.source,
        formula_url: entry.formula_url,
      });
      setPending({
        entry_name: entry.name,
        formula,
        source_label: entry.source,
      });
    } catch (err) {
      alert(`failed to load formula: ${(err as Error).message}`);
    }
  }

  async function installFromGit(): Promise<void> {
    setGitError(null);
    const url = gitUrl.trim();
    if (!url) return;
    try {
      const formula_url = normaliseGitToFormulaUrl(url);
      const { formula } = await resolveMut.mutateAsync({ formula_url });
      setPending({ entry_name: formula.name, formula, source_label: url });
      setGitUrl("");
    } catch (err) {
      setGitError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <SourcesPanel />

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-mono">
          Install from Git
        </h3>
        <p className="text-xs text-zinc-500">
          Any MCP repo with a <code className="text-zinc-400">pier.yaml</code> at its root, or a
          direct link to a <code className="text-zinc-400">.yaml</code> formula.
        </p>
        <div className="flex gap-2">
          <input
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            placeholder="github.com/owner/repo  or  https://.../pier.yaml"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={installFromGit}
            disabled={!gitUrl || resolveMut.isPending}
            className="bg-zinc-100 text-zinc-900 rounded-md px-4 text-sm font-medium disabled:opacity-40"
          >
            Load
          </button>
        </div>
        {gitError && <p className="text-xs text-rose-400">{gitError}</p>}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-mono">
            Explore ({totalCount})
          </h3>
          <div className="flex gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="search…"
              className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-zinc-600"
            />
            <button
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded-md border border-zinc-800 hover:bg-zinc-900 disabled:opacity-40"
            >
              {refresh.isPending ? "…" : "refresh all"}
            </button>
          </div>
        </div>

        {q.isLoading && <p className="text-sm text-zinc-500">loading catalogs…</p>}
        {q.isError && (
          <p className="text-sm text-rose-400">{(q.error as Error).message}</p>
        )}
        {!q.isLoading && sources.length === 0 && (
          <p className="text-sm text-zinc-500">
            No catalogs subscribed. Add one in{" "}
            <span className="text-zinc-300">Sources</span> above.
          </p>
        )}

        {debouncedFilter.length >= 2 && (
          <RegistrySearchResults
            query={debouncedFilter}
            loading={registrySearch.isFetching}
            error={registrySearch.error as Error | null}
            entries={registrySearch.data?.entries ?? []}
            localMatchedNames={new Set(
              sources
                .filter((s) => s.enabled && s.name === "mcp-registry")
                .flatMap((s) => s.entries.map((e) => e.name)),
            )}
            onInstall={(entry) => openEntryInstall(entry)}
            resolving={resolveMut.isPending}
          />
        )}

        <div className="space-y-6">
          {sources
            .filter((s) => s.enabled)
            .map((source) => {
              const entries = filterEntries(source.entries);
              if (filter && entries.length === 0) return null;
              return (
                <div key={source.name} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-zinc-300">
                      {source.name}
                    </span>
                    {source.verified ? (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        ✓ {entries.length} entries
                      </span>
                    ) : (
                      <span className="text-[10px] text-rose-400 font-mono">
                        error: {source.error ?? "unreachable"}
                      </span>
                    )}
                  </div>
                  {source.verified && entries.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {entries.map((entry) => (
                        <EntryCard
                          key={`${source.name}/${entry.name}`}
                          entry={entry}
                          sourceName={source.name}
                          onInstall={() => openEntryInstall(entry)}
                          loading={resolveMut.isPending}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </section>

      {pending && (
        <InstallModal
          entry_name={pending.entry_name}
          formula={pending.formula}
          source_label={pending.source_label}
          onClose={() => setPending(null)}
          onInstalled={() => {
            setPending(null);
            qc.invalidateQueries({ queryKey: ["manifest"] });
            qc.invalidateQueries({ queryKey: ["secrets"] });
          }}
        />
      )}
    </div>
  );
}

function RegistrySearchResults({
  query,
  loading,
  error,
  entries,
  localMatchedNames,
  onInstall,
  resolving,
}: {
  query: string;
  loading: boolean;
  error: Error | null;
  entries: CatalogSource["entries"];
  localMatchedNames: Set<string>;
  onInstall: (entry: CatalogSource["entries"][number]) => void;
  resolving: boolean;
}): JSX.Element {
  const newOnly = entries.filter((e) => !localMatchedNames.has(e.name));
  return (
    <div className="space-y-2 border border-zinc-900 rounded-md p-3 bg-zinc-950/50">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold text-emerald-300">
          Registry search
        </span>
        <span className="text-[10px] text-zinc-500 font-mono">query "{query}"</span>
        {loading && <span className="text-[10px] text-zinc-500">searching…</span>}
        {!loading && !error && (
          <span className="text-[10px] text-zinc-500 font-mono">
            {newOnly.length} new / {entries.length} total
          </span>
        )}
        {error && (
          <span className="text-[10px] text-rose-400">{error.message}</span>
        )}
      </div>
      {!loading && newOnly.length === 0 && entries.length === 0 && !error && (
        <p className="text-xs text-zinc-600">
          no matches on the official MCP Registry for "{query}".
        </p>
      )}
      {newOnly.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {newOnly.map((entry) => (
            <EntryCard
              key={`search/${entry.name}`}
              entry={entry}
              sourceName="mcp-registry"
              onInstall={() => onInstall(entry)}
              loading={resolving}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  sourceName,
  onInstall,
  loading,
}: {
  entry: CatalogSource["entries"][number];
  sourceName: string;
  onInstall: () => void;
  loading: boolean;
}): JSX.Element {
  const isRegistry = sourceName === "mcp-registry";
  const ownerLabel = entry.authority?.owner.startsWith("github:")
    ? entry.authority.owner.slice(7)
    : entry.authority?.owner;
  return (
    <div className="border border-zinc-900 rounded-md p-4 space-y-2 bg-zinc-950 hover:border-zinc-800 transition-colors">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-zinc-100">{displayName(entry.name)}</span>
        {isRegistry ? (
          <span
            className="text-[10px] text-emerald-400 font-mono uppercase"
            title="Namespace-verified via the official MCP Registry"
          >
            ✓ registry
          </span>
        ) : entry.verified ? (
          <span
            className="text-[10px] text-amber-400 font-mono uppercase"
            title="Self-declared by the catalog maintainer — trust the catalog you subscribe to."
          >
            ✓ curated
          </span>
        ) : null}
      </div>
      {ownerLabel && (
        <div className="text-[10px] text-zinc-500 font-mono">
          owned by <span className="text-zinc-300">{ownerLabel}</span>
        </div>
      )}
      <p className="text-xs text-zinc-400">{entry.description}</p>
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-zinc-600 font-mono truncate" title={entry.source}>
          {entry.source}
        </span>
        <button
          onClick={onInstall}
          disabled={loading}
          className="bg-zinc-100 text-zinc-900 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-40"
        >
          Install
        </button>
      </div>
    </div>
  );
}

function displayName(registryName: string): string {
  const slash = registryName.indexOf("/");
  return slash === -1 ? registryName : registryName.slice(slash + 1);
}

function normaliseGitToFormulaUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.endsWith(".yaml") || trimmed.endsWith(".yml") || trimmed.endsWith(".json")) {
    return trimmed;
  }
  const m = trimmed.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/pier.yaml`;
  }
  return trimmed.replace(/\/$/, "") + "/pier.yaml";
}
