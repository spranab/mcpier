import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import type { ClientKind, Manifest, ServerEntry } from "@mcpier/shared";

export interface RenderedServer {
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function interpolate(template: string, secrets: Record<string, string>): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, k) => secrets[k] ?? "");
}

export interface RenderOptions {
  /** Pier server URL, used to rewrite remote-mode servers to proxy URLs. */
  pierServer: string;
  /** Device token to include in remote-mode Authorization headers. */
  pierToken: string;
}

export function renderServer(
  name: string,
  entry: ServerEntry,
  secrets: Record<string, string>,
  opts: RenderOptions,
): RenderedServer {
  if (entry.location === "remote") {
    // Claude Code / Cursor / Claude Desktop all expect the SSE stream URL
    // to end in /sse — verified against a live working config during v0.1.4
    // debugging (previously-working yantrikdb entry had url ending /sse).
    const url = `${opts.pierServer.replace(/\/$/, "")}/mcp/${encodeURIComponent(name)}/sse`;
    return {
      transport: entry.transport === "stdio" ? "sse" : entry.transport,
      url,
      headers: { Authorization: `Bearer ${opts.pierToken}` },
    };
  }
  if (entry.transport === "stdio") {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.env)) {
      env[k] = interpolate(v, secrets);
    }
    return { transport: "stdio", command: entry.command, args: entry.args, env };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry.headers)) {
    headers[k] = interpolate(v, secrets);
  }
  return { transport: entry.transport, url: entry.url, headers };
}

export function renderManifest(
  manifest: Manifest,
  secrets: Record<string, string>,
  opts: RenderOptions,
): Record<string, RenderedServer> {
  const out: Record<string, RenderedServer> = {};
  for (const [name, entry] of Object.entries(manifest.servers)) {
    out[name] = renderServer(name, entry, secrets, opts);
  }
  return out;
}

function claudeConfigPath(): string {
  if (platform() === "win32") {
    return join(process.env["APPDATA"] ?? homedir(), "Claude", "claude_desktop_config.json");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function claudeCodeConfigPath(): string {
  return join(homedir(), ".claude.json");
}

function cursorConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

function codexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

/** Claude Code, Claude Desktop, Cursor all expect `type` as the discriminator
 * in their JSON config format — not `transport`. We carry `transport` around
 * internally (matching the MCP protocol spec) and translate at write time. */
function toJsonEntry(s: RenderedServer): Record<string, unknown> {
  const { transport, ...rest } = s;
  return { type: transport, ...rest };
}

function writeJsonMerge(path: string, servers: Record<string, RenderedServer>): void {
  mkdirSync(dirname(path), { recursive: true });
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      existing = {};
    }
  }
  const mcpServers: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) mcpServers[name] = toJsonEntry(s);
  const merged = { ...existing, mcpServers };
  writeFileSync(path, JSON.stringify(merged, null, 2));
}

function renderedToToml(servers: Record<string, RenderedServer>): string {
  const lines: string[] = [];
  for (const [name, s] of Object.entries(servers)) {
    lines.push(`[mcp_servers.${name}]`);
    if (s.transport === "stdio") {
      lines.push(`command = ${JSON.stringify(s.command)}`);
      lines.push(`args = ${JSON.stringify(s.args ?? [])}`);
      if (s.env && Object.keys(s.env).length > 0) {
        lines.push("env = {");
        const pairs = Object.entries(s.env).map(
          ([k, v]) => `  ${JSON.stringify(k)} = ${JSON.stringify(v)}`,
        );
        lines.push(pairs.join(",\n"));
        lines.push("}");
      }
    } else {
      lines.push(`url = ${JSON.stringify(s.url)}`);
      if (s.headers && Object.keys(s.headers).length > 0) {
        const pairs = Object.entries(s.headers).map(
          ([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`,
        );
        lines.push(`headers = { ${pairs.join(", ")} }`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export interface WriteResult {
  client: ClientKind;
  path: string;
  serverCount: number;
}

export function writeClient(
  client: ClientKind,
  servers: Record<string, RenderedServer>,
): WriteResult {
  let path: string;
  switch (client) {
    case "claude-code":
      path = claudeCodeConfigPath();
      writeJsonMerge(path, servers);
      break;
    case "claude-desktop":
      path = claudeConfigPath();
      writeJsonMerge(path, servers);
      break;
    case "cursor":
      path = cursorConfigPath();
      writeJsonMerge(path, servers);
      break;
    case "codex":
      path = codexConfigPath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, renderedToToml(servers));
      break;
    case "continue":
    case "windsurf":
      throw new Error(`client '${client}' not yet supported`);
  }
  return { client, path, serverCount: Object.keys(servers).length };
}
