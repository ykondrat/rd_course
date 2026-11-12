import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GetObjectCommand } from '@aws-sdk/client-s3';

import { statusOf, Storage } from '../files/storage';
import { ASSETS_PREFIX } from './publish-asset';

interface CachedObject {
  body: Buffer;
  headers: Record<string, string>;
  expiresAt: number;
}

export interface Edge {
  url: string;
  close(): Promise<void>;
}

function cacheSeconds(cacheControl: string | undefined): number {
  if (!cacheControl || /no-store|private/i.test(cacheControl)) return 0;

  const match = /max-age=(\d+)/i.exec(cacheControl);

  return match ? Number(match[1]) : 0;
}

export function startEdge(storage: Storage, port = 0): Promise<Edge> {
  const cache = new Map<string, CachedObject>();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://edge').pathname;
    const cached = cache.get(path);

    if (cached && cached.expiresAt > Date.now()) {
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