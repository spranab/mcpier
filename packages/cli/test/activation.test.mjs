import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve as resolveActivations, evaluateTrigger } from "../src/activation.ts";

function mkManifest(entries) {
  return { version: 1, servers: entries };
}

function stdioEntry(opts) {
  return {
    transport: "stdio",
    command: "node",
    args: [],
    env: {},
    secrets: [],
    location: "local",
    tags: opts.tags ?? [],
    ...(opts.auto_activate ? { auto_activate: opts.auto_activate } : {}),
  };
}

function withTmp(fn) {
  const d = mkdtempSync(join(tmpdir(), "pier-activation-"));
  try {
    return fn(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

test("evaluateTrigger: always → matches unconditionally", () => {
  const entry = stdioEntry({ auto_activate: { triggers: [{ kind: "always" }] } });
  const r = evaluateTrigger(entry, "/nonexistent");
  assert.equal(r.matched, true);
  assert.equal(r.reason.source, "auto-always");
});

test("evaluateTrigger: on_demand → never matches", () => {
  const entry = stdioEntry({ auto_activate: { triggers: [{ kind: "on_demand" }] } });
  const r = evaluateTrigger(entry, "/nonexistent");
  assert.equal(r.matched, false);
});

test("evaluateTrigger: file → matches when path exists", () => {
  const entry = stdioEntry({
    auto_activate: { triggers: [{ kind: "file", path: ".git" }] },
  });
  withTmp((d) => {
    mkdirSync(join(d, ".git"));
    const r = evaluateTrigger(entry, d);
    assert.equal(r.matched, true);
    assert.equal(r.reason.source, "auto-file");
  });
});

test("evaluateTrigger: file → does NOT match when path missing", () => {
  const entry = stdioEntry({
    auto_activate: { triggers: [{ kind: "file", path: ".git" }] },
  });
  withTmp((d) => {
    const r = evaluateTrigger(entry, d);
    assert.equal(r.matched, false);
  });
});

test("evaluateTrigger: glob **/*.sql → matches nested files", () => {
  const entry = stdioEntry({
    auto_activate: { triggers: [{ kind: "glob", pattern: "**/*.sql" }] },
  });
  withTmp((d) => {
    mkdirSync(join(d, "db", "migrations"), { recursive: true });
    writeFileSync(join(d, "db", "migrations", "001.sql"), "SELECT 1;");
    const r = evaluateTrigger(entry, d);
    assert.equal(r.matched, true);
    assert.equal(r.reason.source, "auto-glob");
  });
});

test("evaluateTrigger: missing auto_activate → on_demand (no match)", () => {
  const entry = stdioEntry({});
  const r = evaluateTrigger(entry, "/anywhere");
  assert.equal(r.matched, false);
  assert.equal(r.reason.source, "auto-on-demand");
});

test("resolve: workspace exclude beats user always", () => {
  const manifest = mkManifest({
    x: stdioEntry({ auto_activate: { triggers: [{ kind: "always" }] } }),
  });
  withTmp((d) => {
    const ds = resolveActivations({
      cwd: d,
      manifest,
      profile: { always: ["x"], never: [], include_tags: [] },
      workspace: { include: [], exclude: ["x"], include_tags: [] },
    });
    assert.equal(ds.length, 1);
    assert.equal(ds[0].included, false);
    assert.equal(ds[0].reason.source, "workspace-exclude");
  });
});

test("resolve: user always beats formula on_demand", () => {
  const manifest = mkManifest({
    x: stdioEntry({ auto_activate: { triggers: [{ kind: "on_demand" }] } }),
  });
  withTmp((d) => {
    const ds = resolveActivations({
      cwd: d,
      manifest,
      profile: { always: ["x"], never: [], include_tags: [] },
    });
    assert.equal(ds[0].included, true);
    assert.equal(ds[0].reason.source, "user-always");
  });
});

test("resolve: tag-based include pulls any MCP with the tag", () => {
  const manifest = mkManifest({
    git1: stdioEntry({ tags: ["git", "scm"] }),
    git2: stdioEntry({ tags: ["git"] }),
    other: stdioEntry({ tags: ["unrelated"] }),
  });
  withTmp((d) => {
    const ds = resolveActivations({
      cwd: d,
      manifest,
      profile: { always: [], never: [], include_tags: ["git"] },
    });
    const included = ds.filter((x) => x.included).map((x) => x.name).sort();
    assert.deepEqual(included, ["git1", "git2"]);
  });
});

test("resolve: missing profile + workspace → pure formula advisory", () => {
  const manifest = mkManifest({
    auto: stdioEntry({ auto_activate: { triggers: [{ kind: "always" }] } }),
    skip: stdioEntry({ auto_activate: { triggers: [{ kind: "on_demand" }] } }),
    none: stdioEntry({}),
  });
  withTmp((d) => {
    const ds = resolveActivations({ cwd: d, manifest });
    const map = Object.fromEntries(ds.map((x) => [x.name, x.included]));
    assert.equal(map.auto, true);
    assert.equal(map.skip, false);
    assert.equal(map.none, false);
  });
});

test("resolve: user never blocks formula always", () => {
  const manifest = mkManifest({
    x: stdioEntry({ auto_activate: { triggers: [{ kind: "always" }] } }),
  });
  withTmp((d) => {
    const ds = resolveActivations({
      cwd: d,
      manifest,
      profile: { always: [], never: ["x"], include_tags: [] },
    });
    assert.equal(ds[0].included, false);
    assert.equal(ds[0].reason.source, "user-never");
  });
});
