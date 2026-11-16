import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GetObjectCommand } from '@aws-sdk/client-s3';

import { statusOf, Storage } from '../files/storage';
import { MiB } from '../files/upload-policy';
import { ASSETS_PREFIX } from './publish-asset';

export const EDGE_CACHE_MAX_BYTES = 64 * MiB;

interface CachedObject {
  body: Buffer;
  headers: Record<string, string>;
  expiresAt: number;
}

export interface Edge {
  url: string;
  close(): Promise<void>;
}

class LruCache {
  private readonly entries = new Map<string, CachedObject>();
  private usedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(path: string): CachedObject | undefined {
    const entry = this.entries.get(path);

    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.delete(path);

      return undefined;
    }

    this.entries.delete(path);
    this.entries.set(path, entry);

    return entry;
  }

  set(path: string, entry: CachedObject): void {
    if (entry.body.length > this.maxBytes) return;

    this.delete(path);
    this.entries.set(path, entry);
    this.usedBytes += entry.body.length;

    for (const oldest of this.entries.keys()) {
      if (this.usedBytes <= this.maxBytes) break;

      this.delete(oldest);
    }
  }

  private delete(path: string): void {
    const entry = this.entries.get(path);

    if (!entry) return;

    this.entries.delete(path);
    this.usedBytes -= entry.body.length;
  }
}

function cacheSeconds(cacheControl: string | undefined): number {
  if (!cacheControl || /no-store|private/i.test(cacheControl)) return 0;

  const match = /max-age=(\d+)/i.exec(cacheControl);

  return match ? Number(match[1]) : 0;
}

export function startEdge(storage: Storage, port = 0, maxBytes = EDGE_CACHE_MAX_BYTES): Promise<Edge> {
  const cache = new LruCache(maxBytes);
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://edge').pathname;
    const cached = cache.get(path);

    if (cached) {
      res.writeHead(200, { ...cached.headers, 'x-cache': 'HIT' });
      res.end(cached.body);

      return;
    }

    try {
      const object = await storage.s3.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: `${ASSETS_PREFIX}${path.replace(/^\/+/, '')}` }),
      );
      const body = Buffer.from(await (object.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
      const headers: Record<string, string> = {
        'content-type': object.ContentType ?? 'application/octet-stream',
        'cache-control': object.CacheControl ?? '',
        etag: object.ETag ?? '',
      };
      const ttl = cacheSeconds(object.CacheControl);

      if (ttl > 0) cache.set(path, { body, headers, expiresAt: Date.now() + ttl * 1000 });

      res.writeHead(200, { ...headers, 'x-cache': 'MISS' });
      res.end(body);
    } catch (error) {
      res.writeHead(statusOf(error), { 'x-cache': 'MISS' });
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}
