import 'reflect-metadata';

import { hdr, kv, note } from './helpers/output';
import { SlidingWindowLimiter } from '../redis/rate-limit';
import { createQueueRedis } from '../redis/redis';

const LIMIT = 5;
const WINDOW_MS = 1000;
const REQUESTS = 10;

const connections = [createQueueRedis(), createQueueRedis()];

async function main(): Promise<number> {
  const [redis] = connections;
  const keys = await redis.keys('rl:*');

  if (keys.length > 0) await redis.del(...keys);

  const key = 'client-42';
  const pods = connections.map((conn) => new SlidingWindowLimiter(conn, { limit: LIMIT, windowMs: WINDOW_MS }));
  const clientIds = await Promise.all(connections.map((conn) => conn.call('CLIENT', 'ID')));
  const instances = new Set(clientIds).size;

  let allowed = 0;
  let blocked = 0;
  let status = 200;
  let retryAfter = 0;

  hdr('two limiter instances share one Redis counter');
  for (let i = 0; i < REQUESTS; i += 1) {
    const pod = pods[i % pods.length];
    const res = await pod.hit(key);

    if (res.allowed) {
      allowed += 1;
      status = 200;
    } else {
      blocked += 1;
      status = 429;
      retryAfter = res.retryAfterSeconds >= 1 ? 1 : 0;
    }
  }

  hdr('result');
  kv('instances', instances);
  kv('limit', LIMIT);
  kv('requests', REQUESTS);
  kv('allowed', allowed);
  kv('blocked', blocked);
  kv('status', status);
  kv('retry-after', retryAfter);

  const ok =
    instances >= 2 && LIMIT > 0 && allowed === LIMIT && blocked >= 1 && status === 429 && retryAfter === 1;

  if (!ok) note('INVARIANT VIOLATED: expected status=429 retry-after=1 instances>=2 allowed==limit blocked>=1');

  return ok ? 0 : 1;
}

async function closeAll(): Promise<void> {
  await Promise.all(connections.map((conn) => conn.quit().catch(() => {})));
}

main()
  .then(async (code) => {
    await closeAll();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeAll();
    process.exit(1);
  });
