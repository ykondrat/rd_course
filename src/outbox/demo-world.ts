import { pool } from '../lib/db';

export interface DemoWorld {
  userId: number;
  productId: number;
  priceCents: number;
}

export async function resetWorld(priceCents = 4200): Promise<DemoWorld> {
  await pool.query(
    `TRUNCATE users, products, orders, order_items, idempotency_keys,
             outbox, processed_messages, order_fulfillments RESTART IDENTITY CASCADE`,
  );

  const user = await pool.query(
    `INSERT INTO users (email, full_name) VALUES ('demo@shop.test', 'Demo Buyer') RETURNING id`,
  );

  const product = await pool.query(
    `INSERT INTO products (title, price_cents, currency, sku)
     VALUES ('Demo Product', $1, 'USD', 'DEMO-SKU-1') RETURNING id`,
    [priceCents],
  );

  return {
    userId: Number(user.rows[0].id),
    productId: Number(product.rows[0].id),
    priceCents,
  };
}

export async function countOrders(): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM orders`);

  return rows[0].n as number;
}