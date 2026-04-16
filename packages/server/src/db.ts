import Database from "better-sqlite3";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decrypt, encrypt } from "./crypto.js";

export interface SecretRow {
  key: string;
  value: string;
  updated_at: number;
}

export class SecretStore {
  private db: Database.Database;
  private dbPath: string;
  private dataDir: string;

  constructor(dataDir: string, private masterKey: string) {
    mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.dbPath = join(dataDir, "pier.db");
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         INTEGER NOT NULL,
        actor      TEXT,
        action     TEXT NOT NULL,
        target     TEXT
      );
      CREATE TABLE IF NOT EXISTS catalog_subscriptions (
        name       TEXT PRIMARY KEY,
        url        TEXT NOT NULL UNIQUE,
        enabled    INTEGER NOT NULL DEFAULT 1,
        added_at   INTEGER NOT NULL
      );
    `);
  }

  listSubscriptions(): { name: string; url: string; enabled: boolean; added_at: number }[] {
    const rows = this.db
      .prepare(
        "SELECT name, url, enabled, added_at FROM catalog_subscriptions ORDER BY added_at",
      )
      .all() as { name: string; url: string; enabled: number; added_at: number }[];
    return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }));
  }

  addSubscription(name: string, url: string): void {
    this.db
      .prepare(
        "INSERT INTO catalog_subscriptions (name, url, enabled, added_at) VALUES (?, ?, 1, ?)",
      )
      .run(name, url, Date.now());
  }

  removeSubscription(name: string): boolean {
    const res = this.db.prepare("DELETE FROM catalog_subscriptions WHERE name = ?").run(name);
    return res.changes > 0;
  }

  setSubscriptionEnabled(name: string, enabled: boolean): boolean {
    const res = this.db
      .prepare("UPDATE catalog_subscriptions SET enabled = ? WHERE name = ?")
      .run(enabled ? 1 : 0, name);
    return res.changes > 0;
  }

  seedSubscriptionsFromEnv(pairs: { name: string; url: string }[]): void {
    const existing = this.listSubscriptions();
    if (existing.length > 0) return;
    for (const p of pairs) this.addSubscription(p.name, p.url);
  }

  set(key: string, value: string): void {
    const enc = encrypt(this.masterKey, value);
    this.db
      .prepare(
        "INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, enc, Date.now());
  }

  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM secrets WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (!row) return null;
    return decrypt(this.masterKey, row.value);
  }

  getMany(keys: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = this.get(k);
      if (v !== null) out[k] = v;
    }
    return out;
  }

  list(): string[] {
    const rows = this.db
      .prepare("SELECT key FROM secrets ORDER BY key")
      .all() as { key: string }[];
    return rows.map((r) => r.key);
  }

  delete(key: string): boolean {
    const res = this.db.prepare("DELETE FROM secrets WHERE key = ?").run(key);
    return res.changes > 0;
  }

  audit(actor: string | null, action: string, target: string | null): void {
    this.db
      .prepare(
        "INSERT INTO audit (ts, actor, action, target) VALUES (?, ?, ?, ?)",
      )
      .run(Date.now(), actor, action, target);
  }

  /**
   * Validate that a candidate SQLite file was encrypted with the same master
   * key as the running store. Opens it read-only and attempts to decrypt the
   * first secret row (if any exist). Returns true if valid or empty.
   */
  validateMasterKey(candidateDbPath: string): { ok: true } | { ok: false; error: string } {
    let candidate: Database.Database;
    try {
      candidate = new Database(candidateDbPath, { readonly: true, fileMustExist: true });
    } catch (err) {
      return { ok: false, error: `cannot open candidate db: ${(err as Error).message}` };
    }
    try {
      const row = candidate
        .prepare("SELECT key, value FROM secrets LIMIT 1")
        .get() as { key: string; value: string } | undefined;
      if (!row) return { ok: true };
      decrypt(this.masterKey, row.value);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `master key mismatch: cannot decrypt secret '${(err as Error).message.slice(0, 80)}'`,
      };
    } finally {
      candidate.close();
    }
  }

  /**
   * Atomically replace the on-disk pier.db with the given bytes and reopen.
   * Caller MUST validate via validateMasterKey first. Any stale WAL/SHM
   * sidecar files are removed so SQLite doesn't fight with them on reopen.
   */
  replaceDb(newBytes: Buffer): void {
    this.db.close();
    const staging = `${this.dbPath}.incoming`;
    writeFileSync(staging, newBytes);
    try {
      try { renameSync(`${this.dbPath}-wal`, `${this.dbPath}-wal.old`); } catch { /* ignore */ }
      try { renameSync(`${this.dbPath}-shm`, `${this.dbPath}-shm.old`); } catch { /* ignore */ }
      renameSync(staging, this.dbPath);
    } finally {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
    }
  }
}
