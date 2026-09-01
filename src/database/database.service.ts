import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, types } from 'pg';

types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));
types.setTypeParser(1184, (v: string | null) => (v === null ? null : new Date(v).toISOString()));

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'appuser',
    password: process.env.PGPASSWORD ?? 'apppass',
    database: process.env.PGDATABASE ?? 'appdb',
    max: Number(process.env.PG_POOL_MAX ?? 10),
  });

  query(text: string, params: unknown[] = []): Promise<QueryResult> {
    return this.pool.query(text, params as unknown[] as never);
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const out = await fn(client);

      await client.query('COMMIT');

      return out;
    } catch (err) {
      await client.query('ROLLBACK');

      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
