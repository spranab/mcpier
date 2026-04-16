import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Manifest } from "@mcpier/shared";
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
