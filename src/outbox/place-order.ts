import { PoolClient } from 'pg';

import type { Order } from '../orders/orders.service';
import { fingerprintOf, resolveIdempotency, writeOrderWithOutbox } from './order-write';

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

export async function placeOrder(client: PoolClient, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const fingerprint = fingerprintOf(input.items);

  const outcome = await resolveIdempotency(client, input.idempotencyKey, fingerprint);

  if (outcome.replay) return { order: outcome.order, replay: true };

  const currency = input.items[0].currency;
  const items = input.items.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price_cents: item.unit_price_cents,
    line_total_cents: item.unit_price_cents * item.quantity,
  }));

  const order = await writeOrderWithOutbox(client, input.idempotencyKey, {
    userId: input.userId,
    currency,
    items,
  });

  return { order, replay: false };
}