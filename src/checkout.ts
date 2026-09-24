import { PoolClient } from 'pg';

import { transaction } from './lib/db';

export type CheckoutFailureReason = 'OUT_OF_STOCK' | 'INSUFFICIENT_FUNDS';

export type CheckoutResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: CheckoutFailureReason };

export interface CheckoutRequest {
  userId: string;
  productId: string;
  quantity: number;
}

class CheckoutError extends Error {
  constructor(readonly reason: CheckoutFailureReason) {
    super(reason);
  }
}

async function placeOrder(client: PoolClient, request: CheckoutRequest): Promise<string> {
  const stockUpdate = await client.query<{ price_cents: string }>(
    `UPDATE products
      SET stock = stock - $1
      WHERE id = $2 AND stock >= $1
      RETURNING price_cents`,
    [request.quantity, request.productId],
  );

  if (stockUpdate.rowCount === 0) throw new CheckoutError('OUT_OF_STOCK');

  const priceCents = Number(stockUpdate.rows[0].price_cents);
  const amountCents = priceCents * request.quantity;

  const balanceUpdate = await client.query(
    `UPDATE users
        SET balance_cents = balance_cents - $1
      WHERE id = $2 AND balance_cents >= $1
      RETURNING balance_cents`,
    [amountCents, request.userId],
  );

  if (balanceUpdate.rowCount === 0) throw new CheckoutError('INSUFFICIENT_FUNDS');

  const orderInsert = await client.query<{ id: string }>(
    `INSERT INTO orders (user_id, currency, total_cents, status)
     VALUES ($1, 'USD', $2, 'paid')
     RETURNING id`,
    [request.userId, amountCents],
  );
  const orderId = orderInsert.rows[0].id;

  await client.query(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, line_total_cents)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, request.productId, request.quantity, priceCents, amountCents],
  );

  await client.query(
    `INSERT INTO tasks (type, payload, order_id) VALUES ('order.email', $1, $2)`,
    [JSON.stringify({ orderId }), orderId],
  );

  return orderId;
}

export async function checkout(request: CheckoutRequest): Promise<CheckoutResult> {
  try {
    const orderId = await transaction((client) => placeOrder(client, request));

    return { ok: true, orderId };
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, reason: error.reason };

    throw error;
  }
}