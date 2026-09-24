import { log, note, pool, section, sleep, transaction } from './lib/db';

const TASK_COUNT = 24;
const WORKER_COUNT = 4;
const WORK_MILLISECONDS = 40;

async function seedTasks(): Promise<void> {
  await pool.query('TRUNCATE tasks RESTART IDENTITY');
  await pool.query(
    `INSERT INTO tasks (type, payload)
     SELECT 'demo', jsonb_build_object('n', n) FROM generate_series(1, $1) AS n`,
    [TASK_COUNT],
  );
}

async function claimOneTask(workerName: string): Promise<'processed' | 'empty'> {
  return transaction(async (client) => {
    const claimed = await client.query<{ id: string }>(
      `SELECT id FROM tasks
        WHERE status = 'pending'
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );

    if (claimed.rowCount === 0) return 'empty';

    const taskId = claimed.rows[0].id;

    await sleep(WORK_MILLISECONDS);
    await client.query(
      `UPDATE tasks
          SET status = 'done', processed = processed + 1, worker_id = $1, processed_at = now()
        WHERE id = $2`,
      [workerName, taskId],
    );

    return 'processed';
  });
}

async function runWorker(
  workerName: string,
  processedByWorker: Record<string, number>,
): Promise<void> {
  for (;;) {
    const outcome = await claimOneTask(workerName);

    if (outcome === 'empty') {
      const pending = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM tasks WHERE status = 'pending'`,
      );

      if (Number(pending.rows[0].count) === 0) return;

      await sleep(10);

      continue;
    }

    processedByWorker[workerName] = (processedByWorker[workerName] ?? 0) + 1;
  }
}

async function main(): Promise<number> {
  section('demo:workers — worker pool via FOR UPDATE SKIP LOCKED');

  await seedTasks();

  const processedByWorker: Record<string, number> = {};
  const workerNames = Array.from({ length: WORKER_COUNT }, (_, index) => `worker-${index + 1}`);

  const startedAt = Date.now();

  await Promise.all(workerNames.map((workerName) => runWorker(workerName, processedByWorker)));

  const elapsedMilliseconds = Date.now() - startedAt;

  const doubleProcessed = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM tasks WHERE processed > 1`,
  );
  const done = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM tasks WHERE status = 'done'`,
  );
  const doubleProcessedCount = Number(doubleProcessed.rows[0].count);
  const doneCount = Number(done.rows[0].count);
  const sequentialMilliseconds = TASK_COUNT * WORK_MILLISECONDS;

  note(`distribution: ${workerNames.map((name) => `${name}=${processedByWorker[name] ?? 0}`).join(' ')}`);
  note(`processed twice: ${doubleProcessedCount} (expected 0)`);
  note(`done: ${doneCount}/${TASK_COUNT}`);
  note(`elapsed: ${elapsedMilliseconds}ms vs sequential ${sequentialMilliseconds}ms`);

  const ok = doubleProcessedCount === 0 && doneCount === TASK_COUNT && elapsedMilliseconds < sequentialMilliseconds;

  log(
    ok ? 'OK' : 'FAIL',
    ok ? 'each task processed exactly once, faster than sequential' : 'invariant violation',
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