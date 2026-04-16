import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SecretStore } from "./db.js";
import { ManifestStore } from "./manifest.js";
import { registerRoutes } from "./routes.js";
import { listRemoteServers, registerProxy } from "./proxy.js";
import { CatalogCache } from "./catalog.js";
import { SessionManager } from "./sessions.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.tokens.size === 0) {
    console.warn("[pier] WARNING: PIER_TOKENS is empty — all API requests will 401");
  }

  const store = new SecretStore(config.PIER_DATA_DIR, config.PIER_MASTER_KEY);
  store.seedSubscriptionsFromEnv(
    config.catalogUrls.map((url, i) => ({
      name: defaultCatalogName(url, i),
      url,
    })),
  );
  const manifests = new ManifestStore(config.PIER_MANIFEST_PATH);
  const catalogs = new CatalogCache(
    { list: () => store.listSubscriptions() },
    config.PIER_CATALOG_TTL_SECONDS * 1000,
  );
  const sessions = new SessionManager(store);

  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true });

  registerRoutes(app, config, store, manifests, catalogs, sessions);
  registerProxy(app, config, store, () => manifests.current(), sessions);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[pier] ${signal} received — closing sessions`);
    sessions.closeAll();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const remote = listRemoteServers(manifests.current().manifest);
  if (remote.length > 0) {
    console.log(`[pier] proxying remote servers: ${remote.join(", ")}`);
  }

  const uiDir = config.PIER_UI_DIR ?? resolve(process.cwd(), "../ui/dist");
  if (existsSync(uiDir)) {
    await app.register(fastifyStatic, {
      root: resolve(uiDir),
      prefix: "/",
      decorateReply: false,
    });
    app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
  }

  await app.listen({ port: config.PIER_PORT, host: config.PIER_HOST });
  console.log(`[pier] listening on http://${config.PIER_HOST}:${config.PIER_PORT}`);
}

function defaultCatalogName(url: string, index: number): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    // github raw: /<owner>/<repo>/<ref>/<path...>/<file>.json
    if (u.hostname === "raw.githubusercontent.com" && segs.length >= 4) {
      const repo = segs[1]!;
      const file = segs[segs.length - 1]!.replace(/\.(json|ya?ml)$/, "");
      if (file === "catalog" || file === "index") return repo;
      return `${repo}/${file}`;
    }
    const last = segs[segs.length - 1] ?? "";
    const file = last.replace(/\.(json|ya?ml)$/, "");
    return file || u.hostname || `catalog-${index}`;
  } catch {
    return `catalog-${index}`;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
