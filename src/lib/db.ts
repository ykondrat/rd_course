import { Pool, PoolClient } from 'pg';

import { loadEnv } from '../config/env.schema';

const env = loadEnv();

export const pool = new Pool({
  host: env.PGHOST,
  port: env.PGPORT,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  max: env.PG_POOL_MAX,
});

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const section = (title: string): void => console.log(`\n=== ${title} ===`);
export const log = (tag: string, message: string): void => console.log(`  [${tag}] ${message}`);
export const note = (message: string): void => console.log(`      ${message}`);
export const postgresErrorCode = (error: unknown): string | undefined =>
  (error as { code?: string }).code;

export async function transaction<Result>(
  run: (client: PoolClient) => Promise<Result>,
  isolation: IsolationLevel = 'READ COMMITTED',
): Promise<Result> {
  const client = await pool.connect();

  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);

    const result = await run(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);

    throw error;
  } finally {
    client.release();
  }
}

const RETRYABLE_CODES = new Set(['40001', '40P01']);

export async function withRetry<Result>(
  label: string,
  isolation: IsolationLevel,
  run: (client: PoolClient) => Promise<Result>,
  onRetry?: (code: string) => void,
  maxAttempts = 20,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await transaction(run, isolation);
    } catch (error) {
      const code = postgresErrorCode(error);

      if (code !== undefined && RETRYABLE_CODES.has(code) && attempt < maxAttempts) {
        onRetry?.(code);

        const backoffMilliseconds = Math.round(2 ** attempt * 5 + Math.random() * 15);

        log(label, `attempt ${attempt} failed with ${code} → retry in ${backoffMilliseconds}ms`);

        await sleep(backoffMilliseconds);

        continue;
      }
      throw error;
    }
  }
}