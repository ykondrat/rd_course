import Redis from 'ioredis';

import { loadRedisEnv } from '../config/env.schema';

const env = loadRedisEnv();

export const REDIS_URL = env.REDIS_URL;
export const REDIS_QUEUE_URL = env.REDIS_QUEUE_URL;

export function createCacheRedis(): Redis {
  return new Redis(REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
}

export function createQueueRedis(): Redis {
  return new Redis(REDIS_QUEUE_URL);
}

export const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export const SLIDING_WINDOW_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])
local n = redis.call('ZCARD', KEYS[1])
if n < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;