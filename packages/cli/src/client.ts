import type { Manifest } from "@mcpier/shared";
import type { LocalConfig } from "./config.js";

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
}
