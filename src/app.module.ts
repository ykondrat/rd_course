import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as OpenApiValidator from 'express-openapi-validator';

import { ProblemExceptionFilter } from './common/problem-exception.filter';
import { DatabaseModule } from './database/database.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { HealthController } from './health/health.controller';
import { validate, type Env } from './config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    DatabaseModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemExceptionFilter }],
})
export class AppModule implements NestModule {
  constructor(private readonly config: ConfigService<Env, true>) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        ...OpenApiValidator.middleware({
          apiSpec: this.config.get('OPENAPI_SPEC', { infer: true }),
          validateRequests: true,
          validateResponses: true,
        }),
      )
      .forRoutes('*');
  }
}