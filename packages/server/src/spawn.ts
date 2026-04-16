import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { StdioServer } from "@mcpier/shared";

export type McpMessageHandler = (json: unknown) => void;
export type McpExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void;

export interface McpProcess {
  readonly pid: number | undefined;
  send(message: unknown): void;
  onMessage(h: McpMessageHandler): void;
  onExit(h: McpExitHandler): void;
  kill(): void;
  readonly isAlive: () => boolean;
}

function interpolate(template: string, secrets: Record<string, string>): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, k) => secrets[k] ?? "");
}

export function spawnMcp(
  entry: StdioServer,
  secrets: Record<string, string>,
  logPrefix: string,
): McpProcess {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(entry.env)) {
    env[k] = interpolate(v, secrets);
  }

  const child = spawn(entry.command, entry.args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32",
  }) as ChildProcessWithoutNullStreams;

  let alive = true;
  let onMessage: McpMessageHandler = () => {};
  let onExit: McpExitHandler = () => {};

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      onMessage(msg);
    } catch {
      console.warn(`[${logPrefix}] non-json stdout: ${trimmed.slice(0, 200)}`);
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) console.error(`[${logPrefix}] ${line}`);
    }
  });

  child.on("exit", (code, signal) => {
    alive = false;
    rl.close();
    onExit(code, signal);
  });

  child.on("error", (err) => {
    console.error(`[${logPrefix}] spawn error: ${err.message}`);
    alive = false;
    onExit(null, null);
  });

  return {
    get pid() {
      return child.pid;
    },
    send(message: unknown): void {
      if (!alive) return;
      child.stdin.write(JSON.stringify(message) + "\n");
    },
    onMessage(h: McpMessageHandler): void {
      onMessage = h;
    },
    onExit(h: McpExitHandler): void {
      onExit = h;
    },
    kill(): void {
      if (!alive) return;
      alive = false;
      child.kill();
    },
    isAlive(): boolean {
      return alive;
    },
  };
}
