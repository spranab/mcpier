import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getToken, setToken } from "./api.js";
import { ServersPanel } from "./ServersPanel.js";
import { SecretsPanel } from "./SecretsPanel.js";
import { BrowsePanel } from "./BrowsePanel.js";
import { LoginGate } from "./LoginGate.js";

type Tab = "browse" | "servers" | "secrets";

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("servers");
  const [token, setLocalToken] = useState(getToken());

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30_000,
  });

  if (!token) {
    return (
      <LoginGate
        onSubmit={(t) => {
          setToken(t);
          setLocalToken(t);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Pier</h1>
          <span className="text-xs text-zinc-500 font-mono">MCPs, simpler.</span>
        </div>
        <nav className="flex gap-1">
          <TabButton active={tab === "browse"} onClick={() => setTab("browse")}>
            Browse
          </TabButton>
          <TabButton active={tab === "servers"} onClick={() => setTab("servers")}>
            Servers
          </TabButton>
          <TabButton active={tab === "secrets"} onClick={() => setTab("secrets")}>
            Secrets
          </TabButton>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span
            className={
              health.isSuccess
                ? "text-emerald-400"
                : health.isError
                  ? "text-rose-400"
                  : "text-zinc-500"
            }
          >
            ● {health.isSuccess ? "online" : health.isError ? "offline" : "…"}
          </span>
          <button
            className="text-zinc-500 hover:text-zinc-200"
            onClick={() => {
              setToken(null);
              setLocalToken(null);
            }}
          >
            logout
          </button>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-5xl w-full mx-auto">
        {tab === "browse" && <BrowsePanel />}
        {tab === "servers" && <ServersPanel />}
        {tab === "secrets" && <SecretsPanel />}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 text-sm rounded-md transition-colors " +
        (active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900")
      }
    >
      {children}
    </button>
  );
}
