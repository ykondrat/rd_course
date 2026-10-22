import 'reflect-metadata';

import type { ChannelModel } from 'amqplib';

import { assertTopology, connect, hdr, kv, note, Q, waitFor } from './messaging/amqp';
import { pool, transaction } from './lib/db';
import { CONSUMER, startFulfillmentConsumer } from './outbox/consumer';
import { resetWorld } from './outbox/demo-world';
import { FulfillmentRepository } from './outbox/fulfillment.repository';
import { OutboxRepository } from './outbox/outbox.repository';
import { placeOrder, PlaceOrderInput } from './outbox/place-order';
import { ProcessedMessagesRepository } from './outbox/processed-messages.repository';
import { relayOnce } from './outbox/relay';

const outboxRepo = new OutboxRepository();
const processedRepo = new ProcessedMessagesRepository();
const fulfillmentRepo = new FulfillmentRepository();

async function main(conn: ChannelModel): Promise<number> {
  await assertTopology(conn);

  const admin = await conn.createChannel();

  await admin.purgeQueue(Q.orderPlaced);
  await admin.purgeQueue(Q.dlq);
  await admin.close().catch(() => {});

  const world = await resetWorld();

  hdr('place one order (one outbox event)');

  const input: PlaceOrderInput = {
    idempotencyKey: 'demo-crash-relay-key-1',
    userId: world.userId,
    items: [
      { product_id: world.productId, quantity: 1, unit_price_cents: world.priceCents, currency: 'USD' },
    ],
  };

  await transaction(async (client) => {
    await placeOrder(client, input);
  });

  hdr('relay pass #1: publish, then DIE before UPDATE published_at (simulated abort)');
  try {
    await relayOnce({ abortBeforeUpdate: true });
  } catch {
    note('relay crashed between publish and UPDATE (expected) — published_at stays NULL');
  }

  hdr('relay pass #2: the same event is still unpublished -> published AGAIN');
  await relayOnce();
  const published = await outboxRepo.countPublished(pool);

  hdr('idempotent consumer: two deliveries, effect applied exactly once');

  const counters = { deliveries: 0, applied: 0, skipped: 0 };
  const consumeCh = await conn.createChannel();
  await startFulfillmentConsumer(consumeCh, counters, 1);

  await waitFor(
    'event delivered at least twice and processed once',
    async () => counters.deliveries >= 2 && (await processedRepo.count(pool, CONSUMER)) === 1,
  );
  await waitFor('duplicate skipped by dedup', () => counters.skipped >= 1);

  await consumeCh.close().catch(() => {});

  const effect = await fulfillmentRepo.count(pool);
  const processed = await processedRepo.count(pool, CONSUMER);

  hdr('result');
  kv('published', published);
  kv('deliveries', counters.deliveries);
  kv('applied', counters.applied);
  kv('effect', effect);
  kv('processed', processed);

  const ok =
    counters.deliveries >= 2 &&
    counters.applied === 1 &&
    effect === 1 &&
    processed === 1;

  if (!ok) {
    note('INVARIANT VIOLATED: expected deliveries>=2 applied=1 effect=1 processed=1');
  }

  return ok ? 0 : 1;
}

connect()
  .then(async (conn) => {
    const code = await main(conn).finally(() => conn.close().catch(() => {}));

    await pool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });