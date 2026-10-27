import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().min(1),
  DATABASE_URL: z.url().optional(),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  PGADMIN_USER: z.string().min(1).optional(),
  PGADMIN_PASSWORD: z.string().min(1).optional(),
  OPENAPI_SPEC: z.string().min(1).default('openapi/openapi.yaml'),
  BROKER_URL: z.string().min(1).default('amqp://app:app@127.0.0.1:5672'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6391'),
  REDIS_QUEUE_URL: z.string().min(1).default('redis://127.0.0.1:6392'),
});

export type Env = z.infer<typeof EnvSchema>;

export const ENV_KEYS = Object.keys(EnvSchema.shape) as (keyof Env)[];

export function validate(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return validate(source);
}

export const BrokerEnvSchema = z.object({ BROKER_URL: EnvSchema.shape.BROKER_URL });

export function loadBrokerEnv(source: NodeJS.ProcessEnv = process.env): { BROKER_URL: string } {
  return BrokerEnvSchema.parse(source);
}

export const RedisEnvSchema = z.object({
  REDIS_URL: EnvSchema.shape.REDIS_URL,
  REDIS_QUEUE_URL: EnvSchema.shape.REDIS_QUEUE_URL,
});

export function loadRedisEnv(
  source: NodeJS.ProcessEnv = process.env,
): { REDIS_URL: string; REDIS_QUEUE_URL: string } {
  return RedisEnvSchema.parse(source);
}
