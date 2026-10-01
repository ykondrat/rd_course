import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

export function configureApp(app: INestApplication): INestApplication {
  app.enableShutdownHooks();

  return app;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  return configureApp(app);
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });

  await app.listen(port);

  console.log(`Marketplace API listening on http://localhost:${port}`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
