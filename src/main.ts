import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });

  await app.listen(port);

  console.log(`Marketplace API listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});