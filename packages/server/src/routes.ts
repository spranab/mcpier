import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  Formula,
  InstallRequest,
  Manifest,
  SecretsRequest,
  SecretSetRequest,
} from "@mcpier/shared";
import type { SecretStore } from "./db.js";
import type { ManifestStore } from "./manifest.js";
import type { Config } from "./config.js";
import type { CatalogCache } from "./catalog.js";
import { fetchFormulaFromUrl, resolveFormula } from "./catalog.js";
import { installFromFormula, uninstall } from "./install.js";
import type { SessionManager } from "./sessions.js";

function deriveName(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length >= 2 && u.hostname.includes("github")) {
      return `${segs[0]}/${segs[1]}`;
    }
    const last = segs[segs.length - 1] ?? "";
    const trimmed = last.replace(/\.(json|ya?ml)$/, "");
    return trimmed || u.hostname;
  } catch {
    return "catalog";
  }
}

function auth(req: FastifyRequest, tokens: Set<string>): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return tokens.has(t) ? t : null;
}

export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  store: SecretStore,
  manifests: ManifestStore,
  catalogs: CatalogCache,
  sessions: SessionManager,
): void {
  app.get("/health", async () => ({ status: "ok", version: "0.1.0" }));

  app.get("/api/manifest", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const cached = manifests.reload();
    return { manifest: cached.manifest, etag: cached.etag };
  });

  app.put("/api/manifest", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const parsed = Manifest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_manifest", issues: parsed.error.issues });
    }
    const cached = manifests.replace(parsed.data);
    store.audit(token.slice(0, 8), "manifest.update", null);
    return { etag: cached.etag };
  });

  app.post("/api/secrets/fetch", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const parsed = SecretsRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const secrets = store.getMany(parsed.data.keys);
    store.audit(token.slice(0, 8), "secrets.fetch", parsed.data.keys.join(","));
    return { secrets };
  });

  app.get("/api/secrets", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    return { keys: store.list() };
  });

  app.put("/api/secrets", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const parsed = SecretSetRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    store.set(parsed.data.key, parsed.data.value);
    store.audit(token.slice(0, 8), "secret.set", parsed.data.key);
    return { ok: true };
  });

  app.delete("/api/secrets/:key", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const { key } = req.params as { key: string };
    const removed = store.delete(key);
    store.audit(token.slice(0, 8), "secret.delete", key);
    return { removed };
  });

  app.get("/api/status", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    return { spawned: sessions.listByName() };
  });

  app.get("/api/catalog", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const sources = await catalogs.ensureFresh();
    return { sources };
  });

  app.post("/api/catalog/refresh", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const sources = await catalogs.forceRefresh();
    store.audit(token.slice(0, 8), "catalog.refresh", null);
    return { sources };
  });

  app.get("/api/catalogs", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    return { subscriptions: store.listSubscriptions() };
  });

  app.post("/api/catalogs", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const body = req.body as { name?: string; url?: string };
    if (!body.url) return reply.code(400).send({ error: "url required" });
    try {
      new URL(body.url);
    } catch {
      return reply.code(400).send({ error: "invalid url" });
    }
    const name = (body.name ?? "").trim() || deriveName(body.url);
    const existing = store.listSubscriptions();
    if (existing.some((s) => s.name === name)) {
      return reply.code(409).send({ error: `catalog '${name}' already exists` });
    }
    if (existing.some((s) => s.url === body.url)) {
      return reply.code(409).send({ error: "catalog URL already subscribed" });
    }
    try {
      store.addSubscription(name, body.url);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
    const refreshed = await catalogs.refreshOne(name);
    store.audit(token.slice(0, 8), "catalog.add", name);
    return { subscription: { name, url: body.url, enabled: true }, source: refreshed };
  });

  app.delete("/api/catalogs/:name", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const { name } = req.params as { name: string };
    const removed = store.removeSubscription(name);
    if (removed) catalogs.forget(name);
    store.audit(token.slice(0, 8), "catalog.remove", name);
    return { removed };
  });

  app.post("/api/catalogs/:name/refresh", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const { name } = req.params as { name: string };
    const source = await catalogs.refreshOne(name);
    if (!source) return reply.code(404).send({ error: "not subscribed" });
    return { source };
  });

  app.patch("/api/catalogs/:name", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const { name } = req.params as { name: string };
    const body = req.body as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return reply.code(400).send({ error: "enabled:boolean required" });
    }
    const ok = store.setSubscriptionEnabled(name, body.enabled);
    if (!ok) return reply.code(404).send({ error: "not subscribed" });
    if (!body.enabled) catalogs.forget(name);
    else await catalogs.refreshOne(name);
    store.audit(token.slice(0, 8), body.enabled ? "catalog.enable" : "catalog.disable", name);
    return { ok: true };
  });

  app.post("/api/catalog/formula", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const body = req.body as { source?: string; formula_url?: string };
    try {
      if (body.formula_url) {
        const formula = await fetchFormulaFromUrl(body.formula_url);
        return { formula };
      }
      if (body.source) {
        const formula = await resolveFormula({
          name: "",
          source: body.source,
          description: "",
          tags: [],
          verified: false,
        });
        return { formula };
      }
      return reply.code(400).send({ error: "need source or formula_url" });
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post("/api/install", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const parsed = InstallRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    const result = installFromFormula(parsed.data, manifests, store);
    store.audit(token.slice(0, 8), "install", parsed.data.install_name);
    return { ok: true, entry_name: result.entry_name };
  });

  app.delete("/api/install/:name", async (req, reply) => {
    const token = auth(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const { name } = req.params as { name: string };
    uninstall(name, manifests);
    store.audit(token.slice(0, 8), "uninstall", name);
    return { ok: true };
  });
}
