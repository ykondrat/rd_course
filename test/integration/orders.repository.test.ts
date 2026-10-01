import 'reflect-metadata';

import { PoolClient } from 'pg';

import { PgHandle, startPg } from './testkit/pg-container';
import { aProduct, aUser } from './testkit/builders';
import { ProductsRepository } from '../../src/products/products.repository';
import { OrdersRepository } from '../../src/orders/orders.repository';
import { Order } from '../../src/orders/orders.service';

describe('OrdersRepository (integration, testcontainers + ROLLBACK)', () => {
  let pg: PgHandle;
  let client: PoolClient;
  const products = new ProductsRepository();
  const orders = new OrdersRepository();

  beforeAll(async () => {
    pg = await startPg('(orders)');
  });

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    client = await pg.pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  it('creates an order with items; JOIN + aggregation confirm the total (SQL-dependent behavior)', async () => {
    const user = await aUser().insertVia(client);
    const product = await aProduct().withPriceCents(2500).withCurrency('USD').insertVia(products, client);
    const quantity = 3;
    const lineTotal = product.price_cents * quantity;
    const order = await orders.insertOrder(client, {
      user_id: user.id,
      currency: 'USD',
      total_cents: lineTotal,
    });

    await orders.insertOrderItem(client, {
      order_id: order.id,
      product_id: product.id,
      quantity,
      unit_price_cents: product.price_cents,
      line_total_cents: lineTotal,
    });

    const { rows } = await client.query(
      `SELECT o.total_cents,
              SUM(oi.line_total_cents)::bigint AS items_total,
              COUNT(oi.id)::int              AS n
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
        WHERE o.id = $1
        GROUP BY o.total_cents`,
      [order.id],
    );

    expect(rows[0].items_total).toBe(lineTotal);
    expect(rows[0].total_cents).toBe(lineTotal);
    expect(rows[0].n).toBe(1);
  });

  it('violates FK: an order with a non-existent user_id → Postgres error 23503 (foreign key)', async () => {
    await expect(
      orders.insertOrder(client, { user_id: 999999, currency: 'USD', total_cents: 100 }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('ON CONFLICT DO NOTHING: the first key claim succeeds, a repeat one does not (idempotency)', async () => {
    const first = await orders.claimIdempotencyKey(client, 'key-abc', 'fingerprint-1');
    const second = await orders.claimIdempotencyKey(client, 'key-abc', 'fingerprint-1');

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('markKeyDone stores the response as jsonb, and findIdempotencyKey reads it back as an object', async () => {
    await orders.claimIdempotencyKey(client, 'key-done', 'fingerprint-2');

    const response: Order = {
      id: 1,
      user_id: 2,
      items: [{ product_id: 3, quantity: 1, line_total_cents: 500 }],
      status: 'new',
      total_cents: 500,
      currency: 'USD',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    await orders.markKeyDone(client, 'key-done', response);

    const rec = await orders.findIdempotencyKey(client, 'key-done');

    expect(rec).not.toBeNull();
    expect(rec!.state).toBe('done');
    expect(rec!.response).toMatchObject({ id: 1, currency: 'USD' });
  });
});
