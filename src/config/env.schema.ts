import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().min(1),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  OPENAPI_SPEC: z.string().min(1).default('openapi/openapi.yaml'),
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