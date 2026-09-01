import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import * as OpenApiValidator from 'express-openapi-validator';

import { ProblemExceptionFilter } from './common/problem-exception.filter';
import { DatabaseModule } from './database/database.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';

const SPEC = process.env.OPENAPI_SPEC ?? 'openapi/openapi.yaml';

@Module({
  imports: [DatabaseModule, ProductsModule, OrdersModule],
  providers: [{ provide: APP_FILTER, useClass: ProblemExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        ...OpenApiValidator.middleware({
          apiSpec: SPEC,
          validateRequests: true,
          validateResponses: true,
        }),
      )
      .forRoutes('*');
  }
}
