import type { ChannelModel } from 'amqplib';

import {
  assertTopology,
  connect,
  depth,
  hdr,
  kv,
  note,
  PREFETCH,
  Q,
  waitFor,
} from './messaging/amqp';
import { effectStats, resetState } from './messaging/effects';
import { idempotentEffect, startConsumer } from './messaging/order-placed.consumer';
import { buildOrderPlaced, type OrderPlacedEvent } from './messaging/order-placed.event';
import { publishOrderPlacedEvents } from './messaging/order-placed.publisher';

const N = 5;
const EFFECTS = 'publish.effects.jsonl';
const PROCESSED = 'publish.processed.txt';

function sampleEvents(): OrderPlacedEvent[] {
  return Array.from({ length: N }, (_unused, i) =>
    buildOrderPlaced(
      {
        orderId: 1000 + i + 1,
        userId: 1,
        totalCents: 2500,
        currency: 'USD',
        items: [{ productId: 1, quantity: 1 }],
      },
      '2026-10-12T00:00:00.000Z',
    ),
  );
}

async function main(conn: ChannelModel): Promise<number> {
  await assertTopology(conn);

  const admin = await conn.createChannel();

  await admin.purgeQueue(Q.orderPlaced);
  await admin.purgeQueue(Q.dlq);

  resetState(EFFECTS, PROCESSED);

  hdr('publish 5 order.placed events on a confirm channel');

  await publishOrderPlacedEvents(sampleEvents());

  const published = N;

  note(`published and confirmed: ${published}`);

  hdr('consume with manual ack (ack AFTER the effect)');

  const counters = { delivered: 0, acked: 0 };
  const effect = idempotentEffect(EFFECTS, PROCESSED);

  const consumeCh = await conn.createChannel();

  await startConsumer(
    consumeCh,
    (event) => {
      counters.delivered += 1;
      effect(event);
      counters.acked += 1;

      return 'ack';
    },
    { prefetch: PREFETCH },
  );

  await waitFor('all 5 delivered', () => counters.delivered === N);
  await waitFor('work queue drained (all acked)', async () => (await depth(admin, Q.orderPlaced)) === 0);

  const effects = effectStats(EFFECTS).total;
  const dlq = await depth(admin, Q.dlq);

  hdr('result');
  kv('published', published);
  kv('delivered', counters.delivered);
  kv('effect', effects);
  kv('acked', counters.acked);
  kv('dlq', dlq);
  kv('prefetch', PREFETCH);

  const ok = published === N && counters.delivered === N && effects === N && counters.acked === N && dlq === 0;

  if (!ok) note('INVARIANT VIOLATED: expected 5 published, 5 delivered, 5 effects, 5 acked, 0 in DLQ');

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
