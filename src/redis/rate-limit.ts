import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

import { SLIDING_WINDOW_LUA } from './redis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly opts: { limit: number; windowMs: number },
  ) {}

  async hit(key: string): Promise<RateLimitResult> {
    const now = Date.now();

    const allowed = await this.redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      `rl:${key}`,
      String(now),
      String(this.opts.windowMs),
      String(this.opts.limit),
      randomUUID(),
    );

    return {
      allowed: allowed === 1,
      retryAfterSeconds: Math.ceil(this.opts.windowMs / 1000),
    };
  }
}
