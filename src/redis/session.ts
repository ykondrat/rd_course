import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 30,
  ) {}

  private key(id: string): string {
    return `sess:${id}`;
  }

  async create(data: Record<string, string>): Promise<string> {
    const id = randomUUID();
    const k = this.key(id);

    await this.redis.hset(k, data);
    await this.redis.expire(k, this.ttlSeconds);

    return id;
  }

  async touch(id: string): Promise<Record<string, string> | null> {
    const k = this.key(id);
    const data = await this.redis.hgetall(k);

    if (Object.keys(data).length === 0) return null;

    await this.redis.expire(k, this.ttlSeconds);

    return data;
  }

  async ttl(id: string): Promise<number> {
    return this.redis.ttl(this.key(id));
  }

  async exists(id: string): Promise<boolean> {
    return (await this.redis.exists(this.key(id))) === 1;
  }
}