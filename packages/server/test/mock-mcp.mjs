#!/usr/bin/env node
// Tiny mock stdio MCP for smoke-testing the Pier bridge.
// Reads newline-delimited JSON-RPC from stdin, responds on stdout.
// Supports: initialize, tools/list, tools/call (echo).

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

process.stderr.write(`[mock-mcp] started pid=${process.pid} env.MOCK_TOKEN=${process.env.MOCK_TOKEN ?? "<unset>"}\n`);

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    process.stderr.write(`[mock-mcp] parse error: ${e.message}\n`);
    return;
  }
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-mcp", version: "0.0.1" },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echoes the input back with a prefix.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      },
    });
    return;
  }
  if (msg.method === "tools/call" && msg.params?.name === "echo") {
    const text = String(msg.params?.arguments?.text ?? "");
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: `mock echoed: ${text} (token=${process.env.MOCK_TOKEN ?? "-"})` }],
      },
    });
    return;
  }
  if (msg.id !== undefined) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
