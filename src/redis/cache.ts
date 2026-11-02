import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

import { UNLOCK_LUA } from './redis';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function jitterTtl(base = 300, range = 60): number {
  return base + Math.floor(Math.random() * range);
}

export interface CacheAsideOptions<T> {
  redis: Redis;
  key: string;
  lockKey: string;
  ttlSeconds: number;
  lockPxMs?: number;
  load: () => Promise<T>;
}

export interface CacheAsideResult<T> {
  value: T;
  hit: boolean;
}

export async function cacheAside<T>(opts: CacheAsideOptions<T>): Promise<CacheAsideResult<T>> {
  const { redis, key, lockKey, ttlSeconds, load } = opts;
  const lockPx = opts.lockPxMs ?? 5000;

  try {
    const cached = await redis.get(key);

    if (cached !== null) return { value: JSON.parse(cached) as T, hit: true };
  } catch {
    return { value: await load(), hit: false };
  }

  const token = randomUUID();

  try {
    for (;;) {
      const got = await redis.set(lockKey, token, 'PX', lockPx, 'NX');

      if (got === 'OK') {
        try {
          const fresh = await redis.get(key);

          if (fresh !== null) return { value: JSON.parse(fresh) as T, hit: true };

          const value = await load();

          await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);

          return { value, hit: false };
        } finally {
          await redis.eval(UNLOCK_LUA, 1, lockKey, token).catch(() => undefined);
        }
      }

      for (;;) {
        await sleep(20);

        const again = await redis.get(key);

        if (again !== null) return { value: JSON.parse(again) as T, hit: true };
        if ((await redis.exists(lockKey)) === 0) break;
      }
    }
  } catch {
    return { value: await load(), hit: false };
  }
}