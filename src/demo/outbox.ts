import 'reflect-metadata';

import type { ChannelModel } from 'amqplib';

import { assertTopology, connect, Q, waitFor } from '../messaging/amqp';
import { hdr, kv, note } from './helpers/output';
import { pool, transaction } from '../lib/db';
import { CONSUMER, startFulfillmentConsumer } from '../outbox/consumer';
import { countOrders, resetWorld } from '../outbox/demo-world';
import { FulfillmentRepository } from '../outbox/fulfillment.repository';
import { OutboxRepository } from '../outbox/outbox.repository';
import { placeOrder, PlaceOrderInput } from '../outbox/place-order';
import { ProcessedMessagesRepository } from '../outbox/processed-messages.repository';
import { relayOnce } from '../outbox/relay';

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

  hdr('two requests with the SAME Idempotency-Key -> one order, one event');

  const input: PlaceOrderInput = {
    idempotencyKey: 'demo-outbox-key-1',
    userId: world.userId,
    items: [
      { product_id: world.productId, quantity: 1, unit_price_cents: world.priceCents, currency: 'USD' },
    ],
  };

  let requests = 0;
  await transaction(async (client) => {
    await placeOrder(client, input);
  });
  requests += 1;
  await transaction(async (client) => {
    await placeOrder(client, input);
  });
  requests += 1;

  const orders = await countOrders();
  const outbox = await outboxRepo.countAll(pool);

  hdr('relay: FOR UPDATE SKIP LOCKED -> publish -> UPDATE published_at');
  await relayOnce();
  const published = await outboxRepo.countPublished(pool);

  hdr('idempotent consumer: processed mark + effect in one transaction');

  const counters = { deliveries: 0, applied: 0, skipped: 0 };
  const consumeCh = await conn.createChannel();
  await startFulfillmentConsumer(consumeCh, counters, 1);

  await waitFor(
    'event delivered and processed once',
    async () => counters.deliveries >= 1 && (await processedRepo.count(pool, CONSUMER)) === 1,
  );

  await consumeCh.close().catch(() => {});

  const effect = await fulfillmentRepo.count(pool);
  const processed = await processedRepo.count(pool, CONSUMER);

  hdr('result');
  kv('requests', requests);
  kv('orders', orders);
  kv('outbox', outbox);
  kv('published', published);
  kv('deliveries', counters.deliveries);
  kv('effect', effect);
  kv('processed', processed);

  const ok =
    requests === 2 &&
    orders === 1 &&
    outbox === 1 &&
    published === 1 &&
    counters.deliveries >= 1 &&
    effect === 1 &&
    processed === 1;

  if (!ok) {
    note('INVARIANT VIOLATED: expected requests=2 orders=1 outbox=1 published=1 effect=1 processed=1');
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