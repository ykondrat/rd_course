import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';

import { OrdersRepository } from '../orders/orders.repository';
import type { Order } from '../orders/orders.service';
import { toOrderPlacedEvent } from './outbox.event';
import { OutboxRepository } from './outbox.repository';

export interface PlaceOrderItem {
  product_id: number;
  quantity: number;
  unit_price_cents: number;
  currency: string;
}

export interface PlaceOrderInput {
  idempotencyKey: string;
  userId: number;
  items: PlaceOrderItem[];
}

export interface PlaceOrderResult {
  order: Order;
  replay: boolean;
}

const ordersRepo = new OrdersRepository();
const outboxRepo = new OutboxRepository();

export async function placeOrder(client: PoolClient, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const fingerprint = createHash('sha256').update(JSON.stringify(input.items)).digest('hex');
  const claimed = await ordersRepo.claimIdempotencyKey(client, input.idempotencyKey, fingerprint);

  if (!claimed) {
    const record = await ordersRepo.findIdempotencyKey(client, input.idempotencyKey);

    return { order: record!.response as Order, replay: true };
  }

  const totalCents = input.items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
  const currency = input.items[0].currency;
  const orderRow = await ordersRepo.insertOrder(client, {
    user_id: input.userId,
    currency,
    total_cents: totalCents,
  });

  for (const item of input.items) {
    await ordersRepo.insertOrderItem(client, {
      order_id: orderRow.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: item.unit_price_cents * item.quantity,
    });
  }

  const order: Order = {
    id: Number(orderRow.id),
    user_id: Number(orderRow.user_id),
    items: input.items.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      line_total_cents: item.unit_price_cents * item.quantity,
    })),
    status: orderRow.status,
    total_cents: Number(orderRow.total_cents),
    currency: orderRow.currency,
    created_at: orderRow.created_at,
  };

  await outboxRepo.insert(client, toOrderPlacedEvent(order));
  await ordersRepo.markKeyDone(client, input.idempotencyKey, order);

  return { order, replay: false };
}