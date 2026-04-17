import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
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
): { values: Record<string, string> } {
  // The entry's `secrets` list mixes required and optional (we don't persist
  // that distinction in the manifest). Return whatever is set, empty string
  // for anything missing — the MCP subprocess decides how to handle absent
  // values. This matches what the CLI writer does for local-mode installs.
  const values = store.getMany(entry.secrets);
  for (const k of entry.secrets) {
    if (!(k in values)) values[k] = "";
  }
  return { values };
}

function resolveUpstream(
  entry: HttpServer,
  store: SecretStore,
): { url: string; headers: Record<string, string> } {
  const { values } = resolveSecretsFor(entry, store);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry.headers)) {
    headers[k] = interpolate(v, values);
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

  // Subpath forwarder for SSE-upstream MCPs. Upstream SSE servers send
  // endpoint events with relative paths (e.g. "/messages/?session_id=X");
  // openSseWithRewrite below rewrites those to "/mcp/:name/messages/?session_id=X"
  // so follow-up POSTs come back here and get forwarded to the upstream
  // origin minus the "/mcp/:name" prefix. Enables proxying any SSE MCP.
  app.post("/mcp/:name/*", async (req, reply) => subpathProxy(req, reply));
  app.put("/mcp/:name/*", async (req, reply) => subpathProxy(req, reply));
  app.delete("/mcp/:name/*", async (req, reply) => subpathProxy(req, reply));

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

    const upCt = upstream.headers.get("content-type");
    console.log(`[proxy] ${name} upstream=${upstream.status} ct=${upCt}`);

    if (upCt?.includes("text/event-stream") && upstream.body) {
      // Hijack the raw response so we can stream the rewritten SSE body
      // without fastify buffering it. Matches the pattern used by the
      // stdio-SSE path above.
      reply.hijack();
      reply.raw.writeHead(upstream.status, {
        "content-type": upCt,
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      console.log(`[proxy] ${name} headers written, piping`);
      const prefix = `/mcp/${encodeURIComponent(name)}`;
      // TEMP DEBUG: bypass rewriter to isolate stream plumbing.
      const rewritten = upstream.body;
      void prefix;
      void rewriteSseEndpoint;
      const node = Readable.fromWeb(rewritten as any);
      node.on("data", (d: Buffer) => console.log(`[proxy] ${name} chunk ${d.length}B: ${d.toString("utf8").slice(0, 120).replace(/\n/g, "\\n")}`));
      node.on("end", () => console.log(`[proxy] ${name} stream ended`));
      node.on("error", (e) => { console.log(`[proxy] ${name} stream err ${e.message}`); reply.raw.end(); });
      reply.raw.on("close", () => { console.log(`[proxy] ${name} raw closed`); node.destroy(); });
      node.pipe(reply.raw);
      return;
    }

    reply.code(upstream.status);
    if (upCt) reply.header("content-type", upCt);
    const buf = await upstream.arrayBuffer();
    return reply.send(Buffer.from(buf));
  }

  async function subpathProxy(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    const token = authFromParams(req, config.tokens);
    if (!token) return reply.code(401).send({ error: "unauthorized" });

    const { name } = req.params as { name: string };
    const subpath = (req.params as Record<string, string>)["*"] ?? "";
    const entry = getManifest().manifest.servers[name];
    if (!entry) return reply.code(404).send({ error: `no server '${name}'` });
    if (entry.location !== "remote") {
      return reply.code(400).send({ error: `server '${name}' is not in remote mode` });
    }
    if (entry.transport === "stdio") {
      return reply
        .code(404)
        .send({ error: "stdio server has no subpath — use /mcp/:name/messages?session=<id>" });
    }

    const resolved = resolveUpstream(entry, store);
    const upstreamUrl = new URL(resolved.url);
    upstreamUrl.pathname = "/" + subpath;
    const qIdx = req.url.indexOf("?");
    if (qIdx !== -1) upstreamUrl.search = req.url.slice(qIdx);

    const forwardHeaders: Record<string, string> = { ...resolved.headers };
    const ct = req.headers["content-type"];
    if (typeof ct === "string") forwardHeaders["content-type"] = ct;
    const accept = req.headers["accept"];
    if (typeof accept === "string") forwardHeaders["accept"] = accept;

    let body: BodyInit | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = JSON.stringify(req.body ?? {});
    }

    store.audit(token.slice(0, 8), `proxy.${req.method}.sub`, `${name}/${subpath}`);

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
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
    const buf = await upstream.arrayBuffer();
    return reply.send(Buffer.from(buf));
  }
}

/**
 * Transform the upstream SSE stream so `event: endpoint\ndata: <path>` events
 * get their path prefixed with `/mcp/:name`. That way the client follows the
 * rewritten URL back into Pier instead of trying to hit the upstream directly.
 * Only the first endpoint event is rewritten; subsequent chunks stream through
 * unchanged. Falls back to passthrough if no endpoint is seen in the first 4KB.
 */
function rewriteSseEndpoint(
  body: ReadableStream<Uint8Array>,
  prefix: string,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pendingText = "";
  let rewriteDone = false;
  let bufferedBytes = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        if (pendingText) controller.enqueue(encoder.encode(pendingText));
        controller.close();
        return;
      }
      if (rewriteDone) {
        controller.enqueue(value);
        return;
      }
      pendingText += decoder.decode(value, { stream: true });
      bufferedBytes += value.byteLength;

      const match = pendingText.match(/event:\s*endpoint\s*\ndata:\s*([^\n]+)\n\n/i);
      if (match) {
        const origPath = match[1]!.trim();
        const newPath = origPath.startsWith("/")
          ? prefix + origPath
          : prefix + "/" + origPath;
        const rewritten = pendingText.replace(
          match[0],
          `event: endpoint\ndata: ${newPath}\n\n`,
        );
        controller.enqueue(encoder.encode(rewritten));
        pendingText = "";
        rewriteDone = true;
        return;
      }

      if (bufferedBytes > 4096) {
        controller.enqueue(encoder.encode(pendingText));
        pendingText = "";
        rewriteDone = true;
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

export function listRemoteServers(manifest: Manifest): string[] {
  return Object.entries(manifest.servers)
    .filter(([, s]) => s.location === "remote")
    .map(([name]) => name);
}
