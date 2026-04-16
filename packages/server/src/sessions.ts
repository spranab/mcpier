import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { StdioServer } from "@mcpier/shared";
import { spawnMcp, type McpProcess } from "./spawn.js";
import type { SecretStore } from "./db.js";

export interface Session {
  id: string;
  name: string;
  process: McpProcess;
  reply: FastifyReply;
  createdAt: number;
  closed: boolean;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private byName: Map<string, Set<string>> = new Map();

  constructor(private store: SecretStore) {}

  listByName(): Record<string, { session_count: number; pids: number[] }> {
    const out: Record<string, { session_count: number; pids: number[] }> = {};
    for (const [name, ids] of this.byName.entries()) {
      const pids: number[] = [];
      for (const id of ids) {
        const s = this.sessions.get(id);
        if (s?.process.pid !== undefined) pids.push(s.process.pid);
      }
      out[name] = { session_count: ids.size, pids };
    }
    return out;
  }

  create(
    name: string,
    entry: StdioServer,
    secrets: Record<string, string>,
    reply: FastifyReply,
  ): Session {
    const id = randomUUID();
    const logPrefix = `mcp:${name}:${id.slice(0, 8)}`;
    const process = spawnMcp(entry, secrets, logPrefix);

    const session: Session = {
      id,
      name,
      process,
      reply,
      createdAt: Date.now(),
      closed: false,
    };

    this.sessions.set(id, session);
    if (!this.byName.has(name)) this.byName.set(name, new Set());
    this.byName.get(name)!.add(id);

    process.onMessage((msg) => {
      if (session.closed) return;
      try {
        reply.raw.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      } catch {
        this.close(id);
      }
    });

    process.onExit((code, signal) => {
      if (session.closed) return;
      try {
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({
            error: "mcp_process_exited",
            code,
            signal,
          })}\n\n`,
        );
      } catch {
        // ignore
      }
      this.close(id);
    });

    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  deliver(id: string, message: unknown): boolean {
    const session = this.sessions.get(id);
    if (!session || session.closed || !session.process.isAlive()) return false;
    session.process.send(message);
    return true;
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.closed) return;
    session.closed = true;
    try {
      session.process.kill();
    } catch {
      // ignore
    }
    try {
      session.reply.raw.end();
    } catch {
      // ignore
    }
    this.sessions.delete(id);
    const bucket = this.byName.get(session.name);
    if (bucket) {
      bucket.delete(id);
      if (bucket.size === 0) this.byName.delete(session.name);
    }
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
