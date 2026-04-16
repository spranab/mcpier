import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export function SecretsPanel(): JSX.Element {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["secrets"], queryFn: () => api.listSecrets() });
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const setMut = useMutation({
    mutationFn: ({ k, v }: { k: string; v: string }) => api.setSecret(k, v),
    onSuccess: () => {
      setKey("");
      setValue("");
      qc.invalidateQueries({ queryKey: ["secrets"] });
    },
  });

  const delMut = useMutation({
    mutationFn: (k: string) => api.deleteSecret(k),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["secrets"] }),
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Add secret</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key && value) setMut.mutate({ k: key, v: value });
          }}
        >
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="key (e.g. openai_key)"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="password"
            placeholder="value"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={!key || !value || setMut.isPending}
            className="bg-zinc-100 text-zinc-900 rounded-md px-4 text-sm font-medium disabled:opacity-40"
          >
            Save
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">
          {q.data?.keys.length ?? 0} stored
        </h2>
        {q.isLoading && <p className="text-sm text-zinc-500">loading…</p>}
        {q.isError && <p className="text-sm text-rose-400">{(q.error as Error).message}</p>}
        {q.data && q.data.keys.length === 0 && (
          <p className="text-sm text-zinc-500">no secrets yet.</p>
        )}
        {q.data && q.data.keys.length > 0 && (
          <div className="divide-y divide-zinc-900 rounded-md border border-zinc-900">
            {q.data.keys.map((k) => (
              <div key={k} className="px-4 py-2.5 flex items-center justify-between">
                <span className="font-mono text-sm text-zinc-200">{k}</span>
                <button
                  onClick={() => {
                    if (confirm(`Delete secret '${k}'?`)) delMut.mutate(k);
                  }}
                  className="text-xs text-zinc-500 hover:text-rose-400"
                >
                  delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
