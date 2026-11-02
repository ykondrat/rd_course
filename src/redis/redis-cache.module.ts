import { Global, Module } from '@nestjs/common';

import { ProductCacheService } from './product-cache.service';

@Global()
@Module({
  providers: [ProductCacheService],
  exports: [ProductCacheService],
})
export class RedisCacheModule {}
