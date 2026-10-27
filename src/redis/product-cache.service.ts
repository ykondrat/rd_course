import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { DatabaseService } from '../database/database.service';
import { cacheAside, jitterTtl } from './cache';
import { loadProductProjection, ProductCard } from './product-projection';
import { createCacheRedis } from './redis';

@Injectable()
export class ProductCacheService implements OnModuleDestroy {
  private readonly bypass = process.env.NODE_ENV === 'test';
  private readonly redis: Redis | null = this.bypass ? null : createCacheRedis();

  constructor(private readonly db: DatabaseService) {
    this.redis?.on('error', () => undefined);
  }

  async getProductCard(id: number): Promise<ProductCard | null> {
    if (!this.redis) return loadProductProjection(this.db, id);

    const { value } = await cacheAside<ProductCard | null>({
      redis: this.redis,
      key: `product:card:${id}`,
      lockKey: `lock:product:card:${id}`,
      ttlSeconds: jitterTtl(300, 60),
      load: () => loadProductProjection(this.db, id),
    });

    return value;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}