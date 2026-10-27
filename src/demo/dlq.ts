import type { ChannelModel } from 'amqplib';

import { assertTopology, connect, depth, Q, waitFor } from '../messaging/amqp';
import { hdr, kv, note } from './helpers/output';
import { effectStats, resetState } from '../messaging/effects';
import { startConsumer } from '../messaging/order-placed.consumer';
import { buildOrderPlaced } from '../messaging/order-placed.event';
import { publishOrderPlacedEvents } from '../messaging/order-placed.publisher';

const EFFECTS = 'dlq.effects.jsonl';
const DEAD_LETTER_REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit'];

async function readDeathReason(conn: ChannelModel): Promise<string> {
  const ch = await conn.createChannel();
  const msg = await ch.get(Q.dlq, { noAck: false });

  if (!msg) {
    await ch.close().catch(() => {});

    return 'none';
  }

  const headers = msg.properties.headers ?? {};
  const reason = String(headers['x-first-death-reason'] ?? 'unknown');

  ch.nack(msg, false, true);
  await ch.close().catch(() => {});

  return reason;
}

async function main(conn: ChannelModel): Promise<number> {
  await assertTopology(conn);

  const admin = await conn.createChannel();

  await admin.purgeQueue(Q.orderPlaced);
  await admin.purgeQueue(Q.dlq);

  resetState(EFFECTS);

  hdr('publish one poison order.placed and reject it (requeue=false)');

  await publishOrderPlacedEvents([
    buildOrderPlaced(
      { orderId: 3001, userId: 1, totalCents: 999, currency: 'USD', items: [{ productId: 1, quantity: 1 }] },
      '2026-10-12T00:00:00.000Z',
    ),
  ]);

  const counters = { rejected: 0 };
  const consumeCh = await conn.createChannel();

  await startConsumer(
    consumeCh,
    () => {
      counters.rejected += 1;

      return 'reject';
    },
    { prefetch: 1 },
  );

  await waitFor('message dead-lettered to DLQ', async () => (await depth(admin, Q.dlq)) === 1);

  const reason = await readDeathReason(conn);

  await waitFor('poison back in DLQ after peek', async () => (await depth(admin, Q.dlq)) === 1);

  const work = await depth(admin, Q.orderPlaced);
  const dlq = await depth(admin, Q.dlq);
  const effect = effectStats(EFFECTS).total;

  hdr('result');
  kv('rejected', counters.rejected);
  kv('work', work);
  kv('dlq', dlq);
  kv('dlq-reason', reason);
  kv('effect', effect);

  const ok = counters.rejected >= 1 && work === 0 && dlq === 1 && DEAD_LETTER_REASONS.includes(reason) && effect === 0;

  if (!ok) note('INVARIANT VIOLATED: expected work=0, dlq=1, a known dlq-reason, effect=0');

  return ok ? 0 : 1;
}

connect()
  .then(async (conn) => {
    const code = await main(conn).finally(() => conn.close().catch(() => {}));

    process.exit(code);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
