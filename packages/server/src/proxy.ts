import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { HttpServer, Manifest, ServerEntry, StdioServer } from "@mcpier/shared";
import type { SecretStore } from "./db.js";
import type { Config } from "./config.js";
import type { LoadedManifest } from "./manifest.js";
import type { SessionManager } from "./sessions.js";

function interpolate(template: string, secrets: Record<string, string>): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, k) => secrets[k] ?? "");
}

function resolveSecretsFor(
  entry: ServerEntry,
  store: SecretStore,
): { values: Record<string, string> } | { error: string } {
  const values = store.getMany(entry.secrets);
  const missing = entry.secrets.filter((k) => !(k in values));
  if (missing.length > 0) return { error: `missing secrets: ${missing.join(", ")}` };
  return { values };
}

function resolveUpstream(
  entry: HttpServer,
  store: SecretStore,
): { url: string; headers: Record<string, string> } | { error: string } {
  const secrets = resolveSecretsFor(entry, store);
  if ("error" in secrets) return { error: secrets.error };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry.headers)) {
    headers[k] = interpolate(v, secrets.values);
  }
  return { url: entry.url, headers };
}

function authFromParams(req: FastifyRequest, tokens: Set<string>): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) {
    const t = h.slice(7).trim();
    if (tokens.has(t)) return t;
  }
  const q = (req.query as Record<string, unknown>)["token"];
  if (typeof q === "string" && tokens.has(q)) return q;
  return null;
}

export function registerProxy(
  app: FastifyInstance,
  config: Config,
  store: SecretStore,
  getManifest: () => LoadedManifest,
  sessions: SessionManager,
): void {
  // SSE open (stdio MCPs) — also handles http/sse-transport passthrough root.
  app.get("/mcp/:name", async (req, reply) => handleRoot(req, reply));
  app.get("/mcp/:name/sse", async (req, reply) => handleRoot(req, reply));

  // Client → server message (stdio spawn path)
  app.post("/mcp/:name/messages", async (req, reply) => {
    const token = authFromParams(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const session_id = (req.query as Record<string, unknown>)["session"];
    if (typeof session_id !== "string") {
      return reply.code(400).send({ error: "missing session" });
    }
    const ok = sessions.deliver(session_id, req.body);
    if (!ok) return reply.code(404).send({ error: "session_not_found_or_closed" });
    store.audit(token.slice(0, 8), "mcp.message", (req.params as { name: string }).name);
    return reply.code(202).send();
  });

  // HTTP transport passthrough (non-GET) + streamable-HTTP POSTs.
  app.post("/mcp/:name", async (req, reply) => httpProxy(req, reply));
  app.put("/mcp/:name", async (req, reply) => httpProxy(req, reply));
  app.delete("/mcp/:name", async (req, reply) => httpProxy(req, reply));

  async function handleRoot(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    const token = authFromParams(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });

    const { name } = req.params as { name: string };
    const entry = getManifest().manifest.servers[name];
    if (!entry) return reply.code(404).send({ error: `no server '${name}'` });
    if (entry.location !== "remote") {
      return reply.code(400).send({ error: `server '${name}' is not in remote mode` });
    }

    if (entry.transport === "stdio") {
      return openStdioSse(name, entry, reply, token);
    }
    return httpProxy(req, reply);
  }

  function openStdioSse(
    name: string,
    entry: StdioServer,
    reply: FastifyReply,
    token: string,
  ): void {
    const secrets = resolveSecretsFor(entry, store);
    if ("error" in secrets) {
      reply.code(500).send({ error: secrets.error });
      return;
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    const session = sessions.create(name, entry, secrets.values, reply);
    store.audit(token.slice(0, 8), "mcp.spawn", `${name}:${session.id.slice(0, 8)}`);

    const endpointPath = `/mcp/${encodeURIComponent(name)}/messages?session=${session.id}`;
    reply.raw.write(`event: endpoint\ndata: ${endpointPath}\n\n`);

    reply.raw.on("close", () => sessions.close(session.id));
    reply.hijack();
  }

  async function httpProxy(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    const token = authFromParams(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });

    const { name } = req.params as { name: string };
    const entry = getManifest().manifest.servers[name];
    if (!entry) return reply.code(404).send({ error: `no server '${name}'` });
    if (entry.location !== "remote") {
      return reply.code(400).send({ error: `server '${name}' is not in remote mode` });
    }
    if (entry.transport === "stdio") {
      return reply.code(400).send({ error: "stdio server uses SSE endpoint, not direct HTTP" });
    }

    const resolved = resolveUpstream(entry, store);
    if ("error" in resolved) return reply.code(500).send({ error: resolved.error });

    const upstreamBase = resolved.url.replace(/\/$/, "");
    const qs = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
    const upstreamUrl = `${upstreamBase}${qs}`;

    const forwardHeaders: Record<string, string> = { ...resolved.headers };
    const ct = req.headers["content-type"];
    if (typeof ct === "string") forwardHeaders["content-type"] = ct;
    const accept = req.headers["accept"];
    if (typeof accept === "string") forwardHeaders["accept"] = accept;

    let body: BodyInit | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = JSON.stringify(req.body ?? {});
    }

    store.audit(token.slice(0, 8), `proxy.${req.method}`, name);

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: forwardHeaders,
        body,
      });
    } catch (err) {
      return reply
        .code(502)
        .send({ error: "upstream_unreachable", detail: (err as Error).message });
    }

    reply.code(upstream.status);
    const upCt = upstream.headers.get("content-type");
    if (upCt) reply.header("content-type", upCt);

    if (upCt?.includes("text/event-stream") && upstream.body) {
      reply.header("cache-control", "no-cache");
      reply.header("connection", "keep-alive");
      return reply.send(upstream.body);
    }

    const buf = await upstream.arrayBuffer();
    return reply.send(Buffer.from(buf));
  }
}

export function listRemoteServers(manifest: Manifest): string[] {
  return Object.entries(manifest.servers)
    .filter(([, s]) => s.location === "remote")
    .map(([name]) => name);
}
