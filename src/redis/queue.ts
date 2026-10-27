import Redis from 'ioredis';

import { REDIS_QUEUE_URL } from './redis';

export const QUEUE_NAME = 'background-jobs';

export function createBullConnection(): Redis {
  return new Redis(REDIS_QUEUE_URL, { maxRetriesPerRequest: null });
}