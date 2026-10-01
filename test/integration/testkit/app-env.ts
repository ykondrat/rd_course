import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DbConnection } from './migrate';

const PASSWORD_FILE = resolve(process.cwd(), 'secrets', 'db_password');

export function resolveDbPassword(): string {
  try {
    return readFileSync(PASSWORD_FILE, 'utf8').trim();
  } catch {
    return process.env.PGPASSWORD ?? 'test-password';
  }
}

export function applyContainerEnv(conn: DbConnection): void {
  process.env.NODE_ENV = 'test';
  process.env.PGHOST = conn.host;
  process.env.PGPORT = String(conn.port);
  process.env.PGUSER = conn.username;
  process.env.PGPASSWORD = conn.password;
  process.env.PGDATABASE = conn.database;
  process.env.DATABASE_URL = `postgres://${conn.username}@${conn.host}:${conn.port}/${conn.database}`;
  process.env.OPENAPI_SPEC = process.env.OPENAPI_SPEC ?? 'openapi/openapi.yaml';
}
