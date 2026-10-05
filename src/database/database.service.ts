import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, PoolClient, QueryResult } from 'pg';

import type { Env } from '../config/env.schema';
import { installPgTypeParsers } from './pg-type-parsers';

installPgTypeParsers();

const PASSWORD_FILE = resolve(process.cwd(), 'secrets', 'db_password');

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(private readonly config: ConfigService<Env, true>) {
    const fallbackPassword = this.config.get('PGPASSWORD', { infer: true });

    this.pool = new Pool({
      ...this.resolveTarget(),
      max: this.config.get('PG_POOL_MAX', { infer: true }),
      password: () => this.readPassword(fallbackPassword),
    });

    this.pool.on('error', (err) => {
      this.logger.warn(`Idle pg client error (expected during rotation): ${err.message}`);
    });
  }

  private resolveTarget(): { host: string; port: number; user: string; database: string } {
    const url = this.config.get('DATABASE_URL', { infer: true });

    if (url) {
      const u = new URL(url);

      return {
        host: u.hostname,
        port: u.port ? Number(u.port) : 5432,
        user: decodeURIComponent(u.username),
        database: u.pathname.replace(/^\//, ''),
      };
    }

    return {
      host: this.config.get('PGHOST', { infer: true }),
      port: this.config.get('PGPORT', { infer: true }),
      user: this.config.get('PGUSER', { infer: true }),
      database: this.config.get('PGDATABASE', { infer: true }),
    };
  }

  private async readPassword(fallback?: string): Promise<string> {
    try {
      return (await readFile(PASSWORD_FILE, 'utf8')).trim();
    } catch {
      if (fallback != null && fallback !== '') return fallback;
      throw new Error(`DB password unavailable: create ${PASSWORD_FILE} or set PGPASSWORD`);
    }
  }

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
