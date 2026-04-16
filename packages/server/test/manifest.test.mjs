import { test } from "node:test";
import assert from "node:assert/strict";
import { Manifest } from "@mcpier/shared";

test("stdio entry parses with defaults", () => {
  const m = Manifest.parse({
    version: 1,
    servers: {
      foo: { transport: "stdio", command: "npx", args: ["-y", "foo-mcp"] },
    },
  });
  assert.equal(m.servers.foo.transport, "stdio");
  assert.equal(m.servers.foo.location, "local");
  assert.deepEqual(m.servers.foo.env, {});
  assert.deepEqual(m.servers.foo.secrets, []);
});

test("sse entry with location: remote parses", () => {
  const m = Manifest.parse({
    version: 1,
    servers: {
      yant: {
        transport: "sse",
        url: "http://example/sse",
        location: "remote",
        secrets: ["token"],
        headers: { Authorization: "Bearer ${token}" },
      },
    },
  });
  assert.equal(m.servers.yant.location, "remote");
  assert.equal(m.servers.yant.transport, "sse");
});

test("unknown transport is rejected", () => {
  assert.throws(() =>
    Manifest.parse({
      version: 1,
      servers: { x: { transport: "wtf", command: "a" } },
    }),
  );
});

test("invalid url is rejected for http transport", () => {
  assert.throws(() =>
    Manifest.parse({
      version: 1,
      servers: { x: { transport: "http", url: "not-a-url" } },
    }),
  );
});

test("location accepts only 'local' or 'remote'", () => {
  assert.throws(() =>
    Manifest.parse({
      version: 1,
      servers: {
        x: { transport: "stdio", command: "n", location: "cloud" },
      },
    }),
  );
});
