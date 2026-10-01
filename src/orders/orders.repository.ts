import { Injectable } from '@nestjs/common';

import { Queryable } from '../common/queryable';
import { Keyset } from '../products/products.repository';
import { Order } from './orders.service';

export interface OrderRow {
  id: number;
  user_id: number;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
}

export interface IdempotencyRecord {
  fingerprint: string;
  state: string;
  response: Order | null;
}

export interface PricedProduct {
  id: number;
  price_cents: number;
  currency: string;
}

export interface OrderItemRow {
  order_id: number;
  product_id: number;
  quantity: number;
  line_total_cents: number;
}

const ORDER_COLS = 'id, user_id, status, total_cents, currency, created_at';

@Injectable()
export class OrdersRepository {
  async claimIdempotencyKey(db: Queryable, key: string, fingerprint: string): Promise<boolean> {
    const claim = await db.query(
      `INSERT INTO idempotency_keys (key, fingerprint, state)
       VALUES ($1, $2, 'in-flight')
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, fingerprint],
    );

    return (claim.rowCount ?? 0) > 0;
  }

  async findIdempotencyKey(db: Queryable, key: string): Promise<IdempotencyRecord | null> {
    const { rows } = await db.query(
      `SELECT fingerprint, state, response FROM idempotency_keys WHERE key = $1`,
      [key],
    );

    return (rows[0] as IdempotencyRecord) ?? null;
  }

  async markKeyDone(db: Queryable, key: string, response: Order): Promise<void> {
    await db.query(`UPDATE idempotency_keys SET state = 'done', response = $2 WHERE key = $1`, [
      key,
      JSON.stringify(response),
    ]);
  }

  async userExists(db: Queryable, id: number): Promise<boolean> {
    const { rowCount } = await db.query(`SELECT 1 FROM users WHERE id = $1`, [id]);

    return (rowCount ?? 0) > 0;
  }

  async findProductsByIds(db: Queryable, ids: number[]): Promise<PricedProduct[]> {
    const { rows } = await db.query(
      `SELECT id, price_cents, currency FROM products WHERE id = ANY($1::int[])`,
      [ids],
    );

    return rows as PricedProduct[];
  }

  async insertOrder(
    db: Queryable,
    order: { user_id: number; currency: string; total_cents: number },
  ): Promise<OrderRow> {
    const { rows } = await db.query(
      `INSERT INTO orders (user_id, currency, total_cents, status) VALUES ($1, $2, $3, 'new')
       RETURNING ${ORDER_COLS}`,
      [order.user_id, order.currency, order.total_cents],
    );

    return rows[0] as OrderRow;
  }

  async insertOrderItem(
    db: Queryable,
    item: {
      order_id: number;
      product_id: number;
      quantity: number;
      unit_price_cents: number;
      line_total_cents: number;
    },
  ): Promise<void> {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, line_total_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [item.order_id, item.product_id, item.quantity, item.unit_price_cents, item.line_total_cents],
    );
  }

  async findOrderById(db: Queryable, id: number): Promise<OrderRow | null> {
    const { rows } = await db.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [id]);

    return (rows[0] as OrderRow) ?? null;
  }

  async listOrders(db: Queryable, opts: { limit: number; after?: Keyset }): Promise<OrderRow[]> {
    const params: unknown[] = [];
    let where = '';

    if (opts.after) {
      params.push(opts.after.createdAt, opts.after.id);
      where = 'WHERE (created_at, id) < ($1, $2)';
    }

    params.push(opts.limit);

    const { rows } = await db.query(
      `SELECT ${ORDER_COLS} FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );

    return rows as OrderRow[];
  }

  async loadItems(db: Queryable, orderIds: number[]): Promise<OrderItemRow[]> {
    const { rows } = await db.query(
      `SELECT order_id, product_id, quantity, line_total_cents
       FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id ASC`,
      [orderIds],
    );

    return rows as OrderItemRow[];
  }
}
