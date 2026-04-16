import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CatalogSource, type CatalogSubscription } from "./api.js";

export function SourcesPanel(): JSX.Element {
  const qc = useQueryClient();
  const subs = useQuery({
    queryKey: ["catalogs"],
    queryFn: () => api.listCatalogs(),
  });
  const cat = useQuery({ queryKey: ["catalog"], queryFn: () => api.getCatalog() });

  const add = useMutation({
    mutationFn: (body: { url: string; name?: string }) => api.addCatalog(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.removeCatalog(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
  const refreshOne = useMutation({
    mutationFn: (name: string) => api.refreshCatalogOne(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
  const toggle = useMutation({
    mutationFn: (x: { name: string; enabled: boolean }) =>
      api.toggleCatalog(x.name, x.enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogs"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  const [open, setOpen] = useState(true);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");

  const list = subs.data?.subscriptions ?? [];
  const statusByName: Record<string, CatalogSource> = {};
  for (const s of cat.data?.sources ?? []) statusByName[s.name] = s;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      await add.mutateAsync({
        url: url.trim(),
        name: name.trim() || undefined,
      });
      setUrl("");
      setName("");
    } catch {
      // error surfaces via add.error
    }
  }

  return (
    <section className="space-y-3 border border-zinc-900 rounded-md bg-zinc-950">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-900/50 rounded-md"
      >
        <div className="flex items-baseline gap-3">
          <h3 className="text-xs uppercase tracking-wider text-zinc-300 font-mono font-semibold">
            Sources
          </h3>
          <span className="text-xs text-zinc-500">
            {list.length} subscribed catalog{list.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className="text-zinc-500 text-xs">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {list.length > 0 && (
            <div className="divide-y divide-zinc-900 rounded-md border border-zinc-900">
              {list.map((sub) => (
                <SubscriptionRow
                  key={sub.name}
                  sub={sub}
                  status={statusByName[sub.name]}
                  onRefresh={() => refreshOne.mutate(sub.name)}
                  onToggle={() =>
                    toggle.mutate({ name: sub.name, enabled: !sub.enabled })
                  }
                  onRemove={() => {
                    if (confirm(`Unsubscribe from '${sub.name}'?`)) remove.mutate(sub.name);
                  }}
                  busy={
                    refreshOne.isPending ||
                    remove.isPending ||
                    toggle.isPending
                  }
                />
              ))}
            </div>
          )}

          <form onSubmit={submit} className="space-y-2">
            <p className="text-xs text-zinc-500">
              Subscribe to any trusted <code className="text-zinc-400">catalog.json</code> URL.
              Official community catalog:{" "}
              <code className="text-zinc-400 text-[10px]">
                github.com/spranab/mcpier-catalog
              </code>
            </p>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/catalog.json"
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
              />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="name (optional)"
                className="w-40 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
              />
              <button
                type="submit"
                disabled={!url.trim() || add.isPending}
                className="bg-zinc-100 text-zinc-900 rounded-md px-4 text-sm font-medium disabled:opacity-40"
              >
                Subscribe
              </button>
            </div>
            {add.isError && (
              <p className="text-xs text-rose-400">{(add.error as Error).message}</p>
            )}
          </form>
        </div>
      )}
    </section>
  );
}

function SubscriptionRow({
  sub,
  status,
  onRefresh,
  onToggle,
  onRemove,
  busy,
}: {
  sub: CatalogSubscription;
  status: CatalogSource | undefined;
  onRefresh: () => void;
  onToggle: () => void;
  onRemove: () => void;
  busy: boolean;
}): JSX.Element {
  const entryCount = status?.entries.length ?? 0;
  const err = status?.error;
  return (
    <div className="px-3 py-2.5 flex items-center gap-3">
      <span className="flex-shrink-0 text-xs font-mono">
        {!sub.enabled
          ? "⊘"
          : err
            ? "⚠"
            : status?.verified
              ? "●"
              : "…"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-zinc-100 text-sm">{sub.name}</span>
          {sub.url.startsWith("mcp-registry:") && (
            <span
              className="text-[10px] text-emerald-300 font-mono uppercase"
              title="Official MCP Registry — namespace-authenticated via reverse-DNS / GitHub org verification."
            >
              authoritative
            </span>
          )}
          {sub.enabled && status && !err && (
            <span className="text-[10px] text-zinc-500 font-mono">
              {entryCount} entries
            </span>
          )}
          {!sub.enabled && (
            <span className="text-[10px] text-zinc-600 font-mono">disabled</span>
          )}
          {err && <span className="text-[10px] text-rose-400 font-mono">{err}</span>}
        </div>
        <div className="text-[10px] text-zinc-600 font-mono truncate">
          {sub.url.startsWith("mcp-registry:")
            ? "registry.modelcontextprotocol.io — backed by Anthropic, GitHub, Microsoft, PulseMCP"
            : sub.url}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <button
          onClick={onRefresh}
          disabled={busy || !sub.enabled}
          className="text-zinc-500 hover:text-zinc-100 px-2 py-1 disabled:opacity-40"
        >
          refresh
        </button>
        <button
          onClick={onToggle}
          disabled={busy}
          className="text-zinc-500 hover:text-zinc-100 px-2 py-1 disabled:opacity-40"
        >
          {sub.enabled ? "disable" : "enable"}
        </button>
        <button
          onClick={onRemove}
          disabled={busy}
          className="text-zinc-500 hover:text-rose-400 px-2 py-1 disabled:opacity-40"
        >
          remove
        </button>
      </div>
    </div>
  );
}
