import { useState } from "react";

export function LoginGate({ onSubmit }: { onSubmit: (token: string) => void }): JSX.Element {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/secrets", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      setError("invalid token");
      return;
    }
    if (!res.ok) {
      setError(`server error: ${res.status}`);
      return;
    }
    onSubmit(token);
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Pier</h1>
          <p className="text-sm text-zinc-500 font-mono">MCPs, simpler.</p>
        </div>
        <label className="block">
          <span className="block text-sm text-zinc-400 mb-1">Device token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-zinc-600 font-mono"
            placeholder="paste a token from PIER_TOKENS"
          />
        </label>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={!token}
          className="w-full bg-zinc-100 text-zinc-900 rounded-md py-2 text-sm font-medium disabled:opacity-40"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
