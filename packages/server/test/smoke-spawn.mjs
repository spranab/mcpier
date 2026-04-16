#!/usr/bin/env node
// End-to-end smoke test for the stdio→SSE bridge.
// Opens /mcp/mock, parses SSE, sends JSON-RPC, asserts responses.

const BASE = process.env.PIER_BASE ?? "http://localhost:8420";
const TOKEN = process.env.PIER_TOKEN ?? "test-token-abc";

function log(...a) { console.log(...a); }
function fail(m) { console.error("FAIL:", m); process.exit(1); }

const received = new Map();
let endpoint = null;

async function openSse() {
  const res = await fetch(`${BASE}/mcp/mock`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "text/event-stream" },
  });
  if (!res.ok) fail(`SSE open failed: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { log("[sse] closed"); return; }
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handleEvent(event);
      }
    }
  })();
}

function handleEvent(raw) {
  const lines = raw.split("\n");
  let name = "message";
  let data = "";
  for (const l of lines) {
    if (l.startsWith("event: ")) name = l.slice(7).trim();
    else if (l.startsWith("data: ")) data += l.slice(6);
  }
  if (name === "endpoint") {
    endpoint = data;
    log("[sse] endpoint:", endpoint);
    return;
  }
  if (name === "message") {
    const msg = JSON.parse(data);
    log("[sse] message:", JSON.stringify(msg));
    if (msg.id !== undefined) received.set(msg.id, msg);
    return;
  }
  if (name === "error") {
    log("[sse] error event:", data);
    return;
  }
}

async function postMessage(msg) {
  if (!endpoint) fail("no endpoint yet");
  const url = endpoint.startsWith("http") ? endpoint : `${BASE}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  if (res.status !== 202) fail(`POST ${url} → ${res.status}`);
}

async function waitFor(id, timeoutMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (received.has(id)) return received.get(id);
    await new Promise((r) => setTimeout(r, 30));
  }
  fail(`timeout waiting for id=${id}`);
}

async function main() {
  log("== set mock_token ==");
  const r = await fetch(`${BASE}/api/secrets`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key: "mock_token", value: "secret-xyz" }),
  });
  if (!r.ok) fail(`set secret: ${r.status}`);

  log("== open SSE ==");
  await openSse();
  // wait for endpoint
  for (let i = 0; i < 100 && !endpoint; i++) await new Promise((r) => setTimeout(r, 30));
  if (!endpoint) fail("never received endpoint event");

  log("== initialize ==");
  await postMessage({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", clientInfo: { name: "smoke", version: "0" } },
  });
  const init = await waitFor(1);
  if (init.result?.serverInfo?.name !== "mock-mcp") fail("init serverInfo wrong");
  log("  serverInfo:", init.result.serverInfo);

  log("== tools/list ==");
  await postMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await waitFor(2);
  if (!list.result?.tools?.some((t) => t.name === "echo")) fail("echo tool not listed");
  log("  tools:", list.result.tools.map((t) => t.name));

  log("== tools/call echo ==");
  await postMessage({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "echo", arguments: { text: "hello pier" } },
  });
  const echo = await waitFor(3);
  const text = echo.result?.content?.[0]?.text ?? "";
  if (!text.includes("hello pier") || !text.includes("secret-xyz")) {
    fail(`echo missing expected output / secret: ${text}`);
  }
  log("  echoed:", text);

  log("== status endpoint shows live session ==");
  const s = await fetch(`${BASE}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }).then((r) => r.json());
  log("  spawned:", JSON.stringify(s.spawned));
  if (!s.spawned.mock || s.spawned.mock.session_count < 1) fail("status does not show mock session");

  log("\nALL CHECKS PASS ✓");
  process.exit(0);
}

main().catch((e) => fail(e.stack ?? e.message));
