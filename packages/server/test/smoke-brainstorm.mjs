#!/usr/bin/env node
// End-to-end: open SSE to /mcp/brainstorm, initialize, list tools.
// This tests the Pier stdio-spawn bridge against a real npm-published MCP.

const BASE = process.env.PIER_BASE ?? "http://localhost:8420";
const TOKEN = process.env.PIER_TOKEN ?? "test-token-abc";

const received = new Map();
let endpoint = null;
let errorEvent = null;

function log(...a) { console.log(...a); }
function fail(m) { console.error("FAIL:", m); process.exit(1); }

async function openSse() {
  const res = await fetch(`${BASE}/mcp/brainstorm`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "text/event-stream" },
  });
  if (!res.ok) fail(`SSE open: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        handleEvent(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
  })();
}

function handleEvent(raw) {
  let name = "message", data = "";
  for (const l of raw.split("\n")) {
    if (l.startsWith("event: ")) name = l.slice(7).trim();
    else if (l.startsWith("data: ")) data += l.slice(6);
  }
  if (name === "endpoint") { endpoint = data; log("[sse] endpoint:", endpoint); return; }
  if (name === "message") {
    const msg = JSON.parse(data);
    log("[sse] message:", JSON.stringify(msg).slice(0, 400));
    if (msg.id !== undefined) received.set(msg.id, msg);
    return;
  }
  if (name === "error") { errorEvent = data; log("[sse] error:", data); return; }
}

async function postMessage(msg) {
  const url = endpoint.startsWith("http") ? endpoint : `${BASE}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  if (res.status !== 202) fail(`POST ${url} → ${res.status}`);
}

async function waitFor(id, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (received.has(id)) return received.get(id);
    if (errorEvent) fail(`error event before id=${id}: ${errorEvent}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  fail(`timeout waiting for id=${id}`);
}

async function main() {
  log("== opening SSE against /mcp/brainstorm ==");
  await openSse();
  for (let i = 0; i < 200 && !endpoint; i++) await new Promise((r) => setTimeout(r, 50));
  if (!endpoint) fail("no endpoint event within 10s");

  log("== initialize (full MCP handshake) ==");
  const t0 = Date.now();
  await postMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pier-smoke", version: "0.1.0" },
    },
  });
  const init = await waitFor(1);
  log(`  init took ${Date.now() - t0}ms`);
  if (init.error) fail(`initialize error: ${JSON.stringify(init.error)}`);
  log("  serverInfo:", JSON.stringify(init.result?.serverInfo));
  log("  capabilities:", JSON.stringify(init.result?.capabilities));

  log("== notifications/initialized ==");
  await postMessage({ jsonrpc: "2.0", method: "notifications/initialized" });

  log("== tools/list ==");
  await postMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await waitFor(2);
  if (list.error) fail(`tools/list error: ${JSON.stringify(list.error)}`);
  const tools = list.result?.tools ?? [];
  log(`  ${tools.length} tool(s):`);
  for (const t of tools) log(`    - ${t.name}: ${(t.description ?? "").slice(0, 80)}`);

  log("\nbrainstorm-mcp is live via Pier ✓");
  process.exit(0);
}

main().catch((e) => fail(e.stack ?? e.message));
