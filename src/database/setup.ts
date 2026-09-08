import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import { loadEnv } from '../config/env.schema';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({
    host: env.PGHOST,
    port: env.PGPORT,
    database: env.PGDATABASE,
    user: env.PGADMIN_USER,
    password: env.PGADMIN_PASSWORD,
  });

  const dir = join(process.cwd(), 'db');

  for (const file of ['roles.sql', 'schema.sql', 'seed.sql', 'grants.sql', 'indexes.sql']) {
    const sql = readFileSync(join(dir, file), 'utf8');

    await pool.query(sql);
    console.log(`applied ${file}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
