import type { ChannelModel } from 'amqplib';

import { assertTopology, connect, hdr, kv, note, PREFETCH, Q, waitFor } from './messaging/amqp';
import { resetState } from './messaging/effects';
import { idempotentEffect, startConsumer } from './messaging/order-placed.consumer';
import { buildOrderPlaced } from './messaging/order-placed.event';
import { publishOrderPlacedEvents } from './messaging/order-placed.publisher';

const EFFECTS = 'duplicate.effects.jsonl';
const PROCESSED = 'duplicate.processed.txt';

async function main(conn: ChannelModel): Promise<number> {
  await assertTopology(conn);

  const admin = await conn.createChannel();

  await admin.purgeQueue(Q.orderPlaced);
  await admin.purgeQueue(Q.dlq);

  resetState(EFFECTS, PROCESSED);

  hdr('publish one order.placed; force a redelivery after the effect');
  await publishOrderPlacedEvents([
    buildOrderPlaced(
      { orderId: 2001, userId: 1, totalCents: 4200, currency: 'USD', items: [{ productId: 1, quantity: 1 }] },
      '2026-10-12T00:00:00.000Z',
    ),
  ]);

  const counters = { deliveries: 0, effect: 0, skipped: 0 };

  let requeuedOnce = false;

  const effect = idempotentEffect(EFFECTS, PROCESSED);
  const consumeCh = await conn.createChannel();

  await startConsumer(
    consumeCh,
    (event) => {
      counters.deliveries += 1;

      const { applied } = effect(event);

      if (applied) {
        counters.effect += 1;

        if (!requeuedOnce) {
          requeuedOnce = true;

          return 'requeue';
        }

        return 'ack';
      }

      counters.skipped += 1;
      return 'ack';
    },
    { prefetch: PREFETCH },
  );

  await waitFor('message delivered at least twice', () => counters.deliveries >= 2);
  await waitFor('duplicate acked (nothing in flight)', () => counters.skipped >= 1);

  hdr('result');
  kv('deliveries', counters.deliveries);
  kv('effect', counters.effect);
  kv('skipped', counters.skipped);

  const ok = counters.deliveries >= 2 && counters.effect === 1 && counters.skipped >= 1;

  if (!ok) note('INVARIANT VIOLATED: expected deliveries>=2, effect=1, skipped>=1');

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
