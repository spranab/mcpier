import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Manifest } from "@mcpier/shared";
import type { SecretStore } from "./db.js";
import type { ManifestStore } from "./manifest.js";

const BACKUP_VERSION = 1;

export interface PierBackup {
  version: 1;
  created_at: string;
  pier_version: string;
  manifest: Manifest;
  pier_db_b64: string;
}

/**
 * Produce a consistent backup of Pier's state:
 *   - current manifest (parsed)
 *   - pier.db via SQLite backup API (WAL-safe, online-consistent)
 * Returns a JSON-serializable bundle.
 */
export function createBackup(
  dataDir: string,
  manifests: ManifestStore,
  serverVersion: string,
  _store: SecretStore,
): PierBackup {
  const dbPath = join(dataDir, "pier.db");
  if (!existsSync(dbPath)) {
    throw new Error(`no pier.db at ${dbPath} — nothing to back up`);
  }
  const tmp = mkdtempSync(join(tmpdir(), "pier-backup-"));
  const snapshotPath = join(tmp, "pier.db");
  try {
    const live = new Database(dbPath, { readonly: true, fileMustExist: true });
    // VACUUM INTO produces a clean, WAL-checkpointed, single-file snapshot.
    live.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
    live.close();
    const bytes = readFileSync(snapshotPath);
    const current = manifests.current().manifest;
    return {
      version: BACKUP_VERSION,
      created_at: new Date().toISOString(),
      pier_version: serverVersion,
      manifest: current,
      pier_db_b64: bytes.toString("base64"),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Restore a Pier backup:
 *   1. Validate the bundle structure.
 *   2. Stage the decoded pier.db in a temp file and try to decrypt one
 *      secret with the live master key — aborts if master keys differ.
 *   3. Atomically swap the live pier.db with the staged bytes; reopen.
 *   4. Replace the manifest YAML with the bundle's manifest.
 */
export function restoreBackup(
  bundle: unknown,
  store: SecretStore,
  manifests: ManifestStore,
): { restored_servers: number } {
  const parsed = parseBundle(bundle);
  const manifest = Manifest.parse(parsed.manifest);
  const dbBytes = Buffer.from(parsed.pier_db_b64, "base64");
  if (dbBytes.length === 0) throw new Error("pier_db_b64 decoded to zero bytes");

  const tmpDir = mkdtempSync(join(tmpdir(), "pier-restore-"));
  const stagedPath = join(tmpDir, "pier.db");
  try {
    writeFileSync(stagedPath, dbBytes);

    // Cheap sanity — the bytes must be a SQLite file.
    const magic = dbBytes.subarray(0, 15).toString("ascii");
    if (magic !== "SQLite format 3") {
      throw new Error("backup bytes are not a SQLite database");
    }

    const v = store.validateMasterKey(stagedPath);
    if (!v.ok) throw new Error(v.error);

    store.replaceDb(dbBytes);
    manifests.replace(manifest);

    return { restored_servers: Object.keys(manifest.servers).length };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

interface RawBundle {
  version: number;
  manifest: unknown;
  pier_db_b64: string;
}

function parseBundle(bundle: unknown): RawBundle {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("backup bundle must be an object");
  }
  const b = bundle as Record<string, unknown>;
  if (b["version"] !== 1) {
    throw new Error(`unsupported backup version: ${b["version"]}`);
  }
  if (typeof b["pier_db_b64"] !== "string" || !b["pier_db_b64"]) {
    throw new Error("backup bundle missing pier_db_b64");
  }
  if (!b["manifest"]) throw new Error("backup bundle missing manifest");
  return b as unknown as RawBundle;
}
