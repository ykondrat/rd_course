import { PoolClient } from 'pg';

import { log, note, pool, section, withRetry } from './lib/db';

const CONCURRENCY = 10;
const STEP_CENTS = 100;

class ReadBarrier {
  private arrived = 0;
  private open!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.open = resolve;
  });

  constructor(private readonly expected: number) {}

  async wait(): Promise<void> {
    this.arrived += 1;
    if (this.arrived >= this.expected) this.open();
    await this.gate;
  }
}

async function incrementBalance(
  counterId: string,
  barrier: ReadBarrier,
  onRetry: () => void,
): Promise<void> {
  await withRetry(
    'increment',
    'REPEATABLE READ',
    async (client: PoolClient) => {
      const current = await client.query<{ balance_cents: string }>(
        `SELECT balance_cents FROM users WHERE id = $1`,
        [counterId],
      );
      const nextBalance = Number(current.rows[0].balance_cents) + STEP_CENTS;

      await barrier.wait();
      await client.query(`UPDATE users SET balance_cents = $1 WHERE id = $2`, [nextBalance, counterId]);
    },
    onRetry,
  );
}

async function main(): Promise<number> {
  section('demo:retry — serialization failures retried under REPEATABLE READ');

  await pool.query(
    `INSERT INTO users (email, full_name, balance_cents)
     VALUES ('retry-counter@example.com', 'Retry Counter', 0)
     ON CONFLICT (email) DO UPDATE SET balance_cents = 0`,
  );

  const counter = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = 'retry-counter@example.com'`,
  );
  const counterId = counter.rows[0].id;

  let serializationRetries = 0;
  const barrier = new ReadBarrier(CONCURRENCY);

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      incrementBalance(counterId, barrier, () => {
        serializationRetries += 1;
      }),
    ),
  );

  const finalRow = await pool.query<{ balance_cents: string }>(
    `SELECT balance_cents FROM users WHERE id = $1`,
    [counterId],
  );
  const finalBalance = Number(finalRow.rows[0].balance_cents);
  const expectedBalance = CONCURRENCY * STEP_CENTS;

  note(`concurrency: ${CONCURRENCY}`);
  note(`serialization retries caught: ${serializationRetries}`);
  note(`final balance: ${finalBalance} (expected ${expectedBalance})`);

  const ok = finalBalance === expectedBalance && serializationRetries >= 1;

  log(
    ok ? 'OK' : 'FAIL',
    ok
      ? `${serializationRetries} retries, final balance arithmetically correct`
      : 'lost update or no retry observed',
  );

  return ok ? 0 : 1;
}

main()
  .then(async (exitCode) => {
    await pool.end();
    process.exit(exitCode);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });