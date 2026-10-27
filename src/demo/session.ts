import 'reflect-metadata';

import { hdr, kv, note, sleep } from './helpers/output';
import { createQueueRedis } from '../redis/redis';
import { SessionStore } from '../redis/session';

const redis = createQueueRedis();

async function main(): Promise<number> {
  const keys = await redis.keys('sess:*');

  if (keys.length > 0) await redis.del(...keys);

  const store = new SessionStore(redis, 30);
  const sessionIds = new Set<string>();

  hdr('create one session, then make >=3 active requests (rolling TTL)');
  const id = await store.create({ userId: '1', csrf: 'tok123' });
  sessionIds.add(id);

  let requests = 0;
  let ttlRenewed = 0;

  for (let i = 0; i < 3; i += 1) {
    await sleep(1500);

    const before = await store.ttl(id);
    const data = await store.touch(id);
    const after = await store.ttl(id);

    requests += 1;
    sessionIds.add(id);

    if (data !== null && after > before) ttlRenewed = 1;

    note(`request ${i + 1}: ttl ${before} -> ${after}`);
  }

  const inRedis = (await store.exists(id)) ? 1 : 0;

  hdr('result');
  kv('requests', requests);
  kv('sessions', sessionIds.size);
  kv('in-redis', inRedis);
  kv('ttl-renewed', ttlRenewed);

  const ok = sessionIds.size === 1 && inRedis === 1 && ttlRenewed === 1 && requests >= 3;

  if (!ok) note('INVARIANT VIOLATED: expected sessions=1 in-redis=1 ttl-renewed=1 requests>=3');

  return ok ? 0 : 1;
}

main()
  .then(async (code) => {
    await redis.quit().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await redis.quit().catch(() => {});
    process.exit(1);
  });