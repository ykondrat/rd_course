import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { Edge, startEdge } from '../cdn/edge';
import { ASSETS_PREFIX, publishAsset } from '../cdn/publish-asset';
import { createStorage, directObjectUrl } from '../files/storage';
import { hdr, kv, note } from './helpers/output';
import { deletePrefix, ensureBucket } from './helpers/storage-harness';

const ASSET_BASE = 'app';

interface Fetched {
  status: number;
  hit: number;
  body: string;
}

async function fetchAsset(url: string): Promise<Fetched> {
  const response = await fetch(url, { cache: 'no-store' });
  const xCache = response.headers.get('x-cache') ?? '';

  return { status: response.status, hit: /^hit/i.test(xCache) ? 1 : 0, body: await response.text() };
}

function buildCss(version: string, nonce: string): string {
  return `/* build ${nonce} */\nbody { color: ${version === 'v1' ? 'crimson' : 'teal'}; }\n`;
}

async function main(): Promise<number> {
  const storage = createStorage();
  let edge: Edge | undefined;

  try {
    await ensureBucket(storage);
    await deletePrefix(storage, `${ASSETS_PREFIX}${ASSET_BASE}.`);

    edge = await startEdge(storage);
    const cdnBase = edge.url;
    note(`cache layer: local edge at ${cdnBase}`);

    hdr('deploy v1 — content hash in the name, Cache-Control set on the object');
    const nonce = randomUUID();
    const cssV1 = buildCss('v1', nonce);
    const v1 = await publishAsset(storage, ASSET_BASE, 'css', cssV1, 'text/css; charset=utf-8');
    note(`v1 -> ${v1.name}`);

    hdr('direct anonymous GET into the bucket, bypassing the cache');
    const direct = await fetch(directObjectUrl(storage, v1.key), { cache: 'no-store' });
    const directStatus = direct.status;
    await direct.arrayBuffer();

    hdr('through the cache layer: first MISS, then HIT');
    const miss = await fetchAsset(`${cdnBase}/${v1.name}`);
    const hit = await fetchAsset(`${cdnBase}/${v1.name}`);
    note(`first hit=${miss.hit}, then hit=${hit.hit}`);

    hdr('deploy v2 — new content, new name, zero invalidations');
    const cssV2 = buildCss('v2', nonce);
    const v2 = await publishAsset(storage, ASSET_BASE, 'css', cssV2, 'text/css; charset=utf-8');
    note(`v2 -> ${v2.name}`);
    const fresh = await fetchAsset(`${cdnBase}/${v2.name}`);
    const old = await fetchAsset(`${cdnBase}/${v1.name}`);

    const newName = v2.name !== v1.name ? 1 : 0;
    const contentChanged = fresh.body === cssV2 && fresh.body !== miss.body ? 1 : 0;
    const oldStillV1 = old.body === cssV1 ? 1 : 0;

    hdr('result');
    kv('direct', directStatus);
    kv('edge-miss', miss.status);
    kv('edge-hit', hit.status);
    kv('cache-hit', hit.hit);
    kv('new-name', newName);
    kv('new-url', fresh.status);
    kv('content-changed', contentChanged);
    kv('old-url-still-v1', oldStillV1);
    kv('invalidations', 0);

    const ok =
      directStatus === 403 &&
      miss.status === 200 &&
      hit.status === 200 &&
      hit.hit === 1 &&
      newName === 1 &&
      fresh.status === 200 &&
      contentChanged === 1;

    if (!ok) note('INVARIANT VIOLATED: expected direct=403 edge-miss=200 edge-hit=200 cache-hit=1 new-name=1 new-url=200 content-changed=1');

    return ok ? 0 : 1;
  } finally {
    if (edge) await edge.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });