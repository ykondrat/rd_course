import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'appuser',
    password: process.env.PGPASSWORD ?? 'apppass',
    database: process.env.PGDATABASE ?? 'appdb',
  });
  const dir = join(process.cwd(), 'db');

  for (const file of ['01-schema.sql', '02-seed.sql']) {
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
