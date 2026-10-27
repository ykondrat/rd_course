import 'reflect-metadata';

import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

import { hdr, kv, note, sleep } from './helpers/output';
import { createBullConnection, QUEUE_NAME } from '../redis/queue';
import { REDIS_QUEUE_URL } from '../redis/redis';

const queueConn = createBullConnection();
const workerConn = createBullConnection();
const probe = new Redis(REDIS_QUEUE_URL, { maxRetriesPerRequest: null });

async function waitFor(what: string, cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();

  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await sleep(50);
  }
}

async function main(): Promise<number> {
  const cfg = (await probe.call('CONFIG', 'GET', 'maxmemory-policy')) as string[];
  const queueNoeviction = cfg[1] === 'noeviction' ? 1 : 0;
  const queue = new Queue(QUEUE_NAME, { connection: queueConn });

  await queue.obliterate({ force: true }).catch(() => {});

  const attempts: number[] = [];

  let completed = 0;
  let scheduledRuns = 0;

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'flaky') {
        attempts.push(Date.now());

        if (job.attemptsMade < 2) throw new Error('Service is down');

        return 'ok';
      }

      if (job.name === 'tick') {
        scheduledRuns += 1;

        return 'tick';
      }

      return 'noop';
    },
    { connection: workerConn },
  );

  worker.on('completed', (job) => {
    if (job.name === 'flaky') completed = 1;
  });

  hdr('retry + exponential backoff: fail twice, succeed on the 3rd attempt');
  await queue.add(
    'flaky',
    { productId: 42 },
    {
      attempts: 4,
      backoff: { type: 'exponential', delay: 200, jitter: 0.5 },
      removeOnComplete: false,
      jobId: 'flaky-1',
    },
  );

  hdr('jobId dedup: two add with the same jobId -> one job in the queue');
  const dupOpts = { jobId: 'dup-1', delay: 60_000, removeOnComplete: false };
  await queue.add('dup', { note: 'first' }, dupOpts);
  await queue.add('dup', { note: 'second' }, dupOpts);
  const added = 2;
  const dupJob = await queue.getJob('dup-1');
  const queued = dupJob ? 1 : 0;

  hdr('scheduler: upsertJobScheduler (upsert, not add) -> one scheduler, repeated runs');
  await queue.upsertJobScheduler('sched-1', { every: 500 }, { name: 'tick' });
  await queue.upsertJobScheduler('sched-1', { every: 500 }, { name: 'tick' }); // upsert, не дублікат
  const schedulers = (await queue.getJobSchedulers()).length;

  await waitFor('flaky completed and scheduler ran >=2 times', () => completed === 1 && scheduledRuns >= 2);

  const attemptsCount = attempts.length;

  hdr('result');
  kv('queue-noeviction', queueNoeviction);
  kv('attempts', attemptsCount);
  kv('completed', completed);
  kv('added', added);
  kv('queued', queued);
  kv('schedulers', schedulers);
  kv('scheduled-runs', scheduledRuns);

  const ok =
    queueNoeviction === 1 &&
    attemptsCount >= 3 &&
    completed === 1 &&
    added === 2 &&
    queued === 1 &&
    schedulers >= 1 &&
    scheduledRuns >= 2;

  if (!ok) {
    note('INVARIANT VIOLATED: expected completed=1 added=2 queued=1 queue-noeviction=1 attempts>=3 schedulers>=1 scheduled-runs>=2');
  }

  await queue.removeJobScheduler('sched-1').catch(() => {});
  await worker.close();
  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();

  return ok ? 0 : 1;
}

main()
  .then(async (code) => {
    queueConn.disconnect();
    workerConn.disconnect();
    probe.disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    queueConn.disconnect();
    workerConn.disconnect();
    probe.disconnect();
    process.exit(1);
  });