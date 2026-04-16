import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { Manifest } from "@mcpier/shared";

export interface LoadedManifest {
  manifest: Manifest;
  etag: string;
  mtime: number;
}

function etagFor(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function loadManifest(path: string): LoadedManifest {
  const raw = readFileSync(path, "utf8");
  const data = YAML.parse(raw);
  const manifest = Manifest.parse(data);
  const mtime = statSync(path).mtimeMs;
  return { manifest, etag: etagFor(raw), mtime };
}

export function writeManifest(path: string, manifest: Manifest): LoadedManifest {
  const raw = YAML.stringify(manifest);
  writeFileSync(path, raw);
  return { manifest, etag: etagFor(raw), mtime: Date.now() };
}

export class ManifestStore {
  private cached: LoadedManifest;

  constructor(private path: string) {
    this.cached = loadManifest(path);
  }

  /** Returns the cached manifest, reloading if the file mtime changed. */
  current(): LoadedManifest {
    const mtime = statSync(this.path).mtimeMs;
    if (mtime > this.cached.mtime) {
      this.cached = loadManifest(this.path);
    }
    return this.cached;
  }

  reload(): LoadedManifest {
    this.cached = loadManifest(this.path);
    return this.cached;
  }

  replace(next: Manifest): LoadedManifest {
    this.cached = writeManifest(this.path, next);
    return this.cached;
  }
}
