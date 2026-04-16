import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import type { StdioServer } from "@mcpier/shared";

/**
 * Wrap `command args` with `prlimit --as=<bytes> -- command args` so the
 * kernel kills the subprocess if it exceeds the memory cap. Only active on
 * Linux where prlimit exists; returns the original command/args otherwise.
 *
 * Accepts memoryMb = 0 as "no limit".
 */
function applyMemoryLimit(
  command: string,
  args: string[],
  memoryMb: number,
): { command: string; args: string[] } {
  if (!memoryMb || memoryMb <= 0) return { command, args };
  if (process.platform !== "linux") return { command, args };
  if (!existsSync("/usr/bin/prlimit") && !existsSync("/bin/prlimit")) {
    return { command, args };
  }
  const bytes = Math.floor(memoryMb * 1024 * 1024);
  return {
    command: "prlimit",
    args: [`--as=${bytes}`, "--", command, ...args],
  };
}

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

export interface SpawnOptions {
  /** Memory cap in MB enforced via prlimit on Linux; 0 = no limit. */
  memoryMb?: number;
}

export function spawnMcp(
  entry: StdioServer,
  secrets: Record<string, string>,
  logPrefix: string,
  options: SpawnOptions = {},
): McpProcess {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(entry.env)) {
    env[k] = interpolate(v, secrets);
  }

  const { command, args } = applyMemoryLimit(
    entry.command,
    entry.args,
    options.memoryMb ?? 0,
  );

  const child = spawn(command, args, {
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
