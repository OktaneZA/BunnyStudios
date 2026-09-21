/**
 * Where generated and uploaded files live (plan D29).
 *
 * Disk on the NAS volume today; Azure Blob later behind the same interface. Nothing in a
 * route touches the filesystem directly. Keys are opaque, generated here, and never derived
 * from user input, so a key can never escape the root.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  sizeBytes: number;
  sha256: string;
}

export interface ObjectStore {
  put(bytes: Buffer, extension: string, scope: { accountId: string; projectId: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<{ stream: Readable; sizeBytes: number }>;
  /** Absolute filesystem path when the store is local (used by ffmpeg); null otherwise. */
  localPath(key: string): string | null;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const KEY = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[0-9a-f]{32}\.[a-z0-9]{1,5}$/;

export function createDiskStore(root: string): ObjectStore {
  const base = resolve(root);
  function pathFor(key: string) {
    if (!KEY.test(key)) throw new Error('Invalid object key');
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error('Invalid object key');
    return full;
  }
  return {
    async put(bytes, extension, scope) {
      const ext = extension.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
      const key = `${scope.accountId}/${scope.projectId}/${randomUUID().replace(/-/g, '')}.${ext}`;
      const full = pathFor(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: 'wx' });
      return { key, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    },
    get: (key) => readFile(pathFor(key)),
    async stream(key) {
      const full = pathFor(key);
      const info = await stat(full);
      return { stream: createReadStream(full), sizeBytes: info.size };
    },
    localPath: (key) => pathFor(key),
    async delete(key) { await rm(pathFor(key), { force: true }); },
    async exists(key) { try { await stat(pathFor(key)); return true; } catch { return false; } },
  };
}

/** In-memory store for tests. */
export function createMemoryStore(): ObjectStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async put(bytes, extension, scope) {
      const key = `${scope.accountId}/${scope.projectId}/${randomUUID().replace(/-/g, '')}.${extension}`;
      objects.set(key, bytes);
      return { key, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    },
    async get(key) { const b = objects.get(key); if (!b) throw new Error('missing'); return b; },
    async stream(key) {
      const { Readable } = await import('node:stream');
      const b = objects.get(key); if (!b) throw new Error('missing');
      return { stream: Readable.from([b]), sizeBytes: b.length };
    },
    localPath: () => null,
    async delete(key) { objects.delete(key); },
    async exists(key) { return objects.has(key); },
  };
}
