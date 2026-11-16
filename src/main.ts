import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { ReadinessService } from './health/readiness.service';
import type { Env } from './config/env.schema';

export function configureApp(app: INestApplication): INestApplication {
  app.enableShutdownHooks();

  return app;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  return configureApp(app);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function drainOnSignal(app: INestApplication, readiness: ReadinessService, drainMs: number): void {
  const shutdown = (signal: NodeJS.Signals): void => {
    if (readiness.isDraining()) return;

    readiness.startDraining();
    console.log(`${signal}: readiness off, draining ${drainMs} ms`);

    setTimeout(() => {
      app
        .close()
        .then(() => {
          console.log('socket closed, exiting');
          process.exit(0);
        })
        .catch((err: unknown) => {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        });
    }, drainMs);
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const readiness = app.get(ReadinessService);
  const port = config.get('PORT', { infer: true });
  const warmupMs = config.get('WARMUP_MS', { infer: true });

  drainOnSignal(app, readiness, config.get('DRAIN_MS', { infer: true }));

  if (warmupMs > 0) {
    console.log(`warming up ${warmupMs} ms before listen`);
    await sleep(warmupMs);
  }

  await app.listen(port);
  readiness.markListening();

  console.log(`Marketplace API listening on http://localhost:${port}`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
