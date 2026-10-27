import 'reflect-metadata';

import Redis from 'ioredis';

import { pool } from '../lib/db';
import { cacheAside, jitterTtl } from '../redis/cache';
import { hdr, kv, note } from './helpers/output';
import { getDbCalls, loadProductProjection, resetDbCalls } from '../redis/product-projection';
import { REDIS_URL } from '../redis/redis';

const PRODUCTS = 60;
const CONCURRENT = 25;

const redis = new Redis(REDIS_URL);
const cacheKey = (id: number): string => `product:card:${id}`;
const lockKey = (id: number): string => `lock:product:card:${id}`;

async function seed(): Promise<number[]> {
  await pool.query(`TRUNCATE reviews, order_items, orders, products RESTART IDENTITY CASCADE`);

  const ids: number[] = [];

  for (let i = 0; i < PRODUCTS; i += 1) {
    const { rows } = await pool.query(
      `INSERT INTO products (title, price_cents, currency, sku, stock) VALUES ($1, $2, 'USD', $3, $4) RETURNING id`,
      [`Product ${i}`, 1000 + i, `CACHE-SKU-${i}`, 10 + i],
    );
    const id = Number(rows[0].id);

    ids.push(id);

    for (let r = 0; r < 3; r += 1) {
      await pool.query(`INSERT INTO reviews (product_id, rating) VALUES ($1, $2)`, [id, 1 + ((i + r) % 5)]);
    }
  }

  return ids;
}

async function main(): Promise<number> {
  await redis.flushall();

  const ids = await seed();

  hdr('cache instance policy (allkeys-lru + maxmemory)');
  const policy = (await redis.call('CONFIG', 'GET', 'maxmemory-policy')) as string[];
  const maxmem = (await redis.call('CONFIG', 'GET', 'maxmemory')) as string[];
  const cacheLru = policy[1] !== 'noeviction' ? 1 : 0;
  const cacheMaxmemory = Number(maxmem[1]) > 0 ? 1 : 0;

  hdr('warm >=50 cards with jittered TTL (300 + random(0..60))');
  for (const id of ids) {
    const card = await loadProductProjection(pool, id);

    await redis.set(cacheKey(id), JSON.stringify(card), 'EX', jitterTtl(300, 60));
  }
  const warmed = ids.length;
  const ttls = await Promise.all(ids.map((id) => redis.ttl(cacheKey(id))));
  const ttlDistinct = new Set(ttls).size;

  hdr('stampede: >=20 concurrent requests on a just-deleted key -> single-flight -> 1 db call');
  const coldId = ids[0];

  await redis.del(cacheKey(coldId));
  resetDbCalls();
  await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      cacheAside({
        redis,
        key: cacheKey(coldId),
        lockKey: lockKey(coldId),
        ttlSeconds: jitterTtl(300, 60),
        load: () => loadProductProjection(pool, coldId),
      }),
    ),
  );
  const dbCalls = getDbCalls();

  hdr('100 reads of a warm key -> 0 db calls');
  const warmId = ids[1];

  resetDbCalls();
  for (let i = 0; i < 100; i += 1) {
    await cacheAside({
      redis,
      key: cacheKey(warmId),
      lockKey: lockKey(warmId),
      ttlSeconds: jitterTtl(300, 60),
      load: () => loadProductProjection(pool, warmId),
    });
  }
  const dbCallsWarm = getDbCalls();

  hdr('result');
  kv('cache-lru', cacheLru);
  kv('cache-maxmemory', cacheMaxmemory);
  kv('warmed', warmed);
  kv('ttl-distinct', ttlDistinct);
  kv('concurrent', CONCURRENT);
  kv('db-calls', dbCalls);
  kv('db-calls-warm', dbCallsWarm);

  const ok =
    cacheLru === 1 &&
    cacheMaxmemory === 1 &&
    warmed >= 50 &&
    ttlDistinct >= 5 &&
    CONCURRENT >= 20 &&
    dbCalls === 1 &&
    dbCallsWarm === 0;

  if (!ok) {
    note('INVARIANT VIOLATED: expected db-calls=1 db-calls-warm=0 cache-lru=1 cache-maxmemory=1 concurrent>=20 warmed>=50 ttl-distinct>=5');
  }

  return ok ? 0 : 1;
}

main()
  .then(async (code) => {
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  });
