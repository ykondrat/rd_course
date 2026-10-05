import 'reflect-metadata';

import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { applyMigrations, DbConnection } from './migrate';
import { resolveDbPassword } from './app-env';
import { installPgTypeParsers } from '../../../src/database/pg-type-parsers';

installPgTypeParsers();

export interface PgHandle {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  uri: string;
  startupMs: number;
  connection: DbConnection;
  stop(): Promise<void>;
}

export async function startPg(label = ''): Promise<PgHandle> {
  const t0 = Date.now();
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('marketplace_test')
    .withUsername('app_user')
    .withPassword(resolveDbPassword())
    .start();
  const startupMs = Date.now() - t0;
  const connection: DbConnection = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  };

  await applyMigrations(connection);

  const pool = new Pool({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: connection.password,
    database: connection.database,
  });

  const uri = container.getConnectionUri();

  console.log(`[testkit] postgres:16-alpine${label ? ' ' + label : ''} ready in ${startupMs} ms`);

  return {
    container,
    pool,
    uri,
    startupMs,
    connection,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
