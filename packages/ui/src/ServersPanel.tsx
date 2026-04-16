import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";
import type { ServerEntry } from "@mcpier/shared";

export function ServersPanel(): JSX.Element {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["manifest"], queryFn: () => api.getManifest() });
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => api.getStatus(),
    refetchInterval: 5000,
  });
  const uninstall = useMutation({
    mutationFn: (name: string) => api.uninstall(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manifest"] });
      qc.invalidateQueries({ queryKey: ["secrets"] });
    },
  });

  if (q.isLoading) return <p className="text-sm text-zinc-500">loading…</p>;
  if (q.isError) return <p className="text-sm text-rose-400">{(q.error as Error).message}</p>;

  const servers = Object.entries(q.data!.manifest.servers);
  const spawned = status.data?.spawned ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">
          {servers.length} server{servers.length === 1 ? "" : "s"}
        </h2>
        <span className="text-xs text-zinc-600 font-mono">etag {q.data!.etag}</span>
      </div>
      <div className="divide-y divide-zinc-900 rounded-md border border-zinc-900">
        {servers.map(([name, entry]) => (
          <ServerRow
            key={name}
            name={name}
            entry={entry}
            sessions={spawned[name]?.session_count ?? 0}
            onUninstall={() => {
              if (confirm(`Remove '${name}' from manifest?`)) uninstall.mutate(name);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ServerRow({
  name,
  entry,
  sessions,
  onUninstall,
}: {
  name: string;
  entry: ServerEntry;
  sessions: number;
  onUninstall: () => void;
}): JSX.Element {
  const remote = entry.location === "remote";
  const spawnable = remote && entry.transport === "stdio";
  return (
    <div className="px-4 py-3 flex items-start gap-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium text-zinc-100">{name}</span>
          <Badge>{entry.transport}</Badge>
          <Badge tone={remote ? "emerald" : "zinc"}>
            {remote ? "remote · via pier" : "local"}
          </Badge>
          {spawnable && (
            <Badge tone={sessions > 0 ? "emerald" : "zinc"}>
              {sessions > 0 ? `● ${sessions} session${sessions === 1 ? "" : "s"}` : "○ idle"}
            </Badge>
          )}
        </div>
        <div className="mt-1 text-xs text-zinc-500 font-mono truncate">
          {entry.transport === "stdio"
            ? `${entry.command} ${entry.args.join(" ")}`
            : entry.url}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {entry.secrets.length > 0 && (
          <div className="text-xs text-zinc-500">
            <span className="text-zinc-600">secrets:</span>{" "}
            <span className="font-mono text-zinc-400">{entry.secrets.join(", ")}</span>
          </div>
        )}
        <button
          onClick={onUninstall}
          className="text-xs text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          remove
        </button>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "zinc",
}: {
  children: React.ReactNode;
  tone?: "zinc" | "emerald";
}): JSX.Element {
  const cls =
    tone === "emerald"
      ? "bg-emerald-950 border-emerald-900 text-emerald-300"
      : "bg-zinc-900 border-zinc-800 text-zinc-400";
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border font-mono ${cls}`}
    >
      {children}
    </span>
  );
}
