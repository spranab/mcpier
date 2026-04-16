import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Formula } from "@mcpier/shared";
import { api } from "./api.js";

export function InstallModal({
  entry_name,
  formula,
  source_label,
  onClose,
  onInstalled,
}: {
  entry_name: string;
  formula: Formula;
  source_label: string;
  onClose: () => void;
  onInstalled: () => void;
}): JSX.Element {
  const [installName, setInstallName] = useState(entry_name);
  const [location, setLocation] = useState<"local" | "remote">(
    formula.remote_eligible ? "remote" : "local",
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const install = useMutation({
    mutationFn: () =>
      api.install({ install_name: installName, formula, secrets, location }),
    onSuccess: () => onInstalled(),
    onError: (err) => setError((err as Error).message),
  });

  const remoteEligibleNow = formula.remote_eligible && formula.transport !== "stdio";
  const missingRequired = formula.secrets.some(
    (s) => s.required && !secrets[s.key]?.trim(),
  );
  const preview = commandPreview(formula);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-zinc-900">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{formula.name}</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100">
              ✕
            </button>
          </div>
          <p className="text-xs text-zinc-400 mt-1">{formula.description}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
              {formula.transport}
            </span>
            {formula.transport === "stdio" && (
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                {formula.runtime}
              </span>
            )}
            {formula.remote_eligible && (
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-900">
                remote-eligible
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-600 font-mono mt-2 truncate">
            source: {source_label}
          </p>
          {preview && (
            <div className="mt-3 text-[10px] text-zinc-500 font-mono bg-black/40 rounded px-2 py-1.5 border border-zinc-900">
              <span className="text-zinc-600">will run: </span>
              <span className="text-zinc-300">{preview}</span>
              {formula.transport === "stdio" && (
                <p className="text-[10px] text-zinc-600 mt-1">
                  Requires <code className="text-zinc-400">{runtimePrereq(formula.runtime)}</code>{" "}
                  on the {location === "local" ? "client machine" : "Pier host"}.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-5 space-y-5">
          <label className="block">
            <span className="block text-xs text-zinc-400 uppercase tracking-wide mb-1">
              Install as
            </span>
            <input
              value={installName}
              onChange={(e) => setInstallName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
            />
            <span className="block text-[10px] text-zinc-600 mt-1">
              This is the key that appears under{" "}
              <code className="text-zinc-500">mcpServers</code> in your client config.
            </span>
          </label>

          <div>
            <span className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">
              Where does this run?
            </span>
            <div className="flex gap-2">
              <LocationButton
                active={location === "local"}
                onClick={() => setLocation("local")}
              >
                local (on each client)
              </LocationButton>
              <LocationButton
                active={location === "remote"}
                onClick={() => setLocation("remote")}
                disabled={!remoteEligibleNow}
              >
                remote (via pier)
              </LocationButton>
            </div>
            {!remoteEligibleNow && formula.transport === "stdio" && (
              <p className="text-[10px] text-zinc-600 mt-1">
                stdio MCPs currently only support <code>local</code>. Remote-spawn is not yet implemented.
              </p>
            )}
          </div>

          {formula.secrets.length > 0 && (
            <div className="space-y-3">
              <span className="block text-xs text-zinc-400 uppercase tracking-wide">
                Secrets
              </span>
              {formula.secrets.map((spec) => (
                <label key={spec.key} className="block">
                  <span className="block text-xs text-zinc-300 mb-1 flex items-center gap-2">
                    {spec.label}
                    {!spec.required && (
                      <span className="text-[10px] text-zinc-600">optional</span>
                    )}
                    {spec.help && (
                      <a
                        href={spec.help}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-zinc-500 hover:text-zinc-300"
                      >
                        where to find this →
                      </a>
                    )}
                  </span>
                  <input
                    type="password"
                    value={secrets[spec.key] ?? ""}
                    onChange={(e) =>
                      setSecrets({ ...secrets, [spec.key]: e.target.value })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    placeholder={spec.key}
                  />
                </label>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>

        <div className="p-5 border-t border-zinc-900 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={() => install.mutate()}
            disabled={install.isPending || !installName || missingRequired}
            className="bg-zinc-100 text-zinc-900 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {install.isPending ? "installing…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}

function commandPreview(formula: Formula): string | null {
  if (formula.transport !== "stdio") return formula.url;
  if (formula.command) {
    return [formula.command, ...formula.args].join(" ");
  }
  if (!formula.package) return null;
  if (formula.runtime === "node") {
    return ["npx", "-y", formula.package, ...formula.args].join(" ");
  }
  if (formula.runtime === "python") {
    return ["uvx", formula.package, ...formula.args].join(" ");
  }
  return [formula.package, ...formula.args].join(" ");
}

function runtimePrereq(runtime: "node" | "python" | "binary"): string {
  switch (runtime) {
    case "node":
      return "node + npx";
    case "python":
      return "uv (for uvx)";
    case "binary":
      return "the binary on PATH";
  }
}

function LocationButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "flex-1 text-xs px-3 py-2 rounded-md border transition-colors " +
        (active
          ? "bg-zinc-100 text-zinc-900 border-zinc-100"
          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700") +
        (disabled ? " opacity-40 cursor-not-allowed" : "")
      }
    >
      {children}
    </button>
  );
}
