import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";

function withEnv(env, fn) {
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (k.startsWith("PIER_")) delete process.env[k];
    Object.assign(process.env, env);
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) if (k.startsWith("PIER_")) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("loadConfig: PIER_MASTER_KEY inline", () => {
  withEnv({ PIER_MASTER_KEY: "a".repeat(64), PIER_TOKENS: "t1" }, () => {
    const c = loadConfig();
    assert.equal(c.masterKey, "a".repeat(64));
  });
});

test("loadConfig: PIER_MASTER_KEY_FILE reads from disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "pier-"));
  const file = join(dir, "key");
  writeFileSync(file, "b".repeat(64) + "\n");
  try {
    withEnv({ PIER_MASTER_KEY_FILE: file, PIER_TOKENS: "t1" }, () => {
      const c = loadConfig();
      assert.equal(c.masterKey, "b".repeat(64));
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("loadConfig: PIER_MASTER_KEY_FILE wins over inline when both present", () => {
  const dir = mkdtempSync(join(tmpdir(), "pier-"));
  const file = join(dir, "key");
  writeFileSync(file, "c".repeat(64));
  try {
    withEnv(
      { PIER_MASTER_KEY_FILE: file, PIER_MASTER_KEY: "zzz".repeat(24), PIER_TOKENS: "t1" },
      () => {
        const c = loadConfig();
        assert.equal(c.masterKey, "c".repeat(64));
      },
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("loadConfig: neither set throws", () => {
  withEnv({ PIER_TOKENS: "t1" }, () => {
    assert.throws(() => loadConfig(), /PIER_MASTER_KEY/);
  });
});

test("loadConfig: short key throws", () => {
  withEnv({ PIER_MASTER_KEY: "short", PIER_TOKENS: "t1" }, () => {
    assert.throws(() => loadConfig(), /32/);
  });
});

test("loadConfig: short key in file throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "pier-"));
  const file = join(dir, "key");
  writeFileSync(file, "short");
  try {
    withEnv({ PIER_MASTER_KEY_FILE: file, PIER_TOKENS: "t1" }, () => {
      assert.throws(() => loadConfig(), /32/);
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
});
