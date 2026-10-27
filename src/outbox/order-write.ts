import { createHash } from 'node:crypto';

import { AppError } from '../common/problem';
import { Queryable } from '../common/queryable';
import { OrdersRepository } from '../orders/orders.repository';
import type { Order } from '../orders/orders.service';
import { toOrderPlacedEvent } from './outbox.event';
import { OutboxRepository } from './outbox.repository';

const ordersRepo = new OrdersRepository();
const outboxRepo = new OutboxRepository();

export interface PricedItem {
  product_id: number;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export type ClaimOutcome = { replay: true; order: Order } | { replay: false };

export function fingerprintOf(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export async function resolveIdempotency(
  db: Queryable,
  key: string,
  fingerprint: string,
): Promise<ClaimOutcome> {
  const claimed = await ordersRepo.claimIdempotencyKey(db, key, fingerprint);

  if (claimed) return { replay: false };

  const rec = await ordersRepo.findIdempotencyKey(db, key);

  if (rec && rec.fingerprint !== fingerprint) {
    throw new AppError(422, 'This Idempotency-Key was already used with a different request body.', {
      code: 'idempotency-key-reuse',
    });
  }

  if (!rec || rec.state === 'in-flight' || rec.response === null) {
    throw new AppError(409, 'A request with this Idempotency-Key is still being processed — retry later.', {
      code: 'idempotency-in-flight',
    });
  }

  return { replay: true, order: rec.response };
}

export async function writeOrderWithOutbox(
  db: Queryable,
  key: string,
  input: { userId: number; currency: string; items: PricedItem[] },
): Promise<Order> {
  const totalCents = input.items.reduce((sum, item) => sum + item.line_total_cents, 0);
  const orderRow = await ordersRepo.insertOrder(db, {
    user_id: input.userId,
    currency: input.currency,
    total_cents: totalCents,
  });

  for (const item of input.items) {
    await ordersRepo.insertOrderItem(db, { order_id: orderRow.id, ...item });
  }

  const order: Order = {
    id: Number(orderRow.id),
    user_id: Number(orderRow.user_id),
    items: input.items.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      line_total_cents: item.line_total_cents,
    })),
    status: orderRow.status,
    total_cents: Number(orderRow.total_cents),
    currency: orderRow.currency,
    created_at: orderRow.created_at,
  };

  await outboxRepo.insert(db, toOrderPlacedEvent(order));
  await ordersRepo.markKeyDone(db, key, order);

  return order;
}