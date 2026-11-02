import 'reflect-metadata';

import { createHash } from 'node:crypto';
import type { ChannelModel } from 'amqplib';

import { assertTopology, connect, depth, Q } from '../messaging/amqp';
import { hdr, kv, note } from './helpers/output';
import { pool, transaction } from '../lib/db';
import { countOrders, resetWorld } from '../outbox/demo-world';
import { FulfillmentRepository } from '../outbox/fulfillment.repository';
import { toOrderPlacedEvent } from '../outbox/outbox.event';
import { OutboxRepository } from '../outbox/outbox.repository';
import { relayOnce } from '../outbox/relay';
import { OrdersRepository } from '../orders/orders.repository';
import type { Order } from '../orders/orders.service';

const ordersRepo = new OrdersRepository();
const outboxRepo = new OutboxRepository();
const fulfillmentRepo = new FulfillmentRepository();

async function main(conn: ChannelModel): Promise<number> {
  await assertTopology(conn);

  const admin = await conn.createChannel();
  await admin.purgeQueue(Q.orderPlaced);
  await admin.purgeQueue(Q.dlq);
  await admin.close().catch(() => {});

  const world = await resetWorld();

  hdr('business transaction fails AFTER inserting the outbox row');

  let writeFailed = 0;

  try {
    await transaction(async (client) => {
      const key = 'demo-crash-write-key-1';
      const fingerprint = createHash('sha256').update('crash-write').digest('hex');

      await ordersRepo.claimIdempotencyKey(client, key, fingerprint);

      const orderRow = await ordersRepo.insertOrder(client, {
        user_id: world.userId,
        currency: 'USD',
        total_cents: world.priceCents,
      });

      await ordersRepo.insertOrderItem(client, {
        order_id: orderRow.id,
        product_id: world.productId,
        quantity: 1,
        unit_price_cents: world.priceCents,
        line_total_cents: world.priceCents,
      });

      const order: Order = {
        id: Number(orderRow.id),
        user_id: Number(orderRow.user_id),
        items: [{ product_id: world.productId, quantity: 1, line_total_cents: world.priceCents }],
        status: orderRow.status,
        total_cents: Number(orderRow.total_cents),
        currency: orderRow.currency,
        created_at: orderRow.created_at,
      };

      await outboxRepo.insert(client, toOrderPlacedEvent(order));

      throw new Error('business write failed after outbox insert');
    });
  } catch {
    writeFailed = 1;
  }

  const orders = await countOrders();
  const outbox = await outboxRepo.countAll(pool);

  hdr('relay has nothing to publish');
  await relayOnce();
  const published = await outboxRepo.countPublished(pool);

  const ch = await conn.createChannel();
  const deliveries = await depth(ch, Q.orderPlaced);
  await ch.close().catch(() => {});

  const effect = await fulfillmentRepo.count(pool);

  hdr('result');
  kv('write-failed', writeFailed);
  kv('orders', orders);
  kv('outbox', outbox);
  kv('published', published);
  kv('deliveries', deliveries);
  kv('effect', effect);

  const ok =
    writeFailed === 1 &&
    orders === 0 &&
    outbox === 0 &&
    published === 0 &&
    deliveries === 0 &&
    effect === 0;

  if (!ok) {
    note('INVARIANT VIOLATED: expected write-failed=1 orders=0 outbox=0 published=0 deliveries=0 effect=0');
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