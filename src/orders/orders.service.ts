import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { DatabaseService } from '../database/database.service';
import { AppError } from '../common/problem';
import { buildPage, Page } from '../common/pagination';
import { decodeCursor } from '../common/cursor';

export interface OrderItem {
  product_id: number;
  quantity: number;
  line_total_cents: number;
}

export interface Order {
  id: number;
  user_id: number;
  items: OrderItem[];
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
}

export interface CreateOrderBody {
  user_id: number;
  items: Array<{ product_id: number; quantity: number }>;
}

export interface CreateResult {
  order: Order;
  replay: boolean;
}

interface OrderRow {
  id: number;
  user_id: number;
  status: string;
  total_cents: number;
  currency: string;
  created_at: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly db: DatabaseService) {}

  async list(limit: number, cursor?: string): Promise<Page<Order>> {
    const params: unknown[] = [];
    let where = '';

    if (cursor) {
      const { c, id } = decodeCursor(cursor);

      params.push(c, id);
      where = 'WHERE (created_at, id) < ($1, $2)';
    }

    params.push(limit + 1);

    const sql = `SELECT id, user_id, status, total_cents, currency, created_at FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    const { rows } = await this.db.query(sql, params);
    const page = buildPage(rows as OrderRow[], limit);
    const itemsByOrder = await this.loadItems(page.items.map((o) => o.id));

    return {
      items: page.items.map((o) => this.assemble(o, itemsByOrder.get(o.id) ?? [])),
      next_cursor: page.next_cursor,
    };
  }

  async getById(id: number): Promise<Order> {
    const { rows } = await this.db.query(
      `SELECT id, user_id, status, total_cents, currency, created_at FROM orders WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) throw new AppError(404, `Order ${id} not found`);

    const itemsByOrder = await this.loadItems([id]);

    return this.assemble(rows[0] as OrderRow, itemsByOrder.get(id) ?? []);
  }

  async create(key: string, body: CreateOrderBody): Promise<CreateResult> {
    const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    return this.db.withTransaction(async (client) => {
      const claim = await client.query(
        `INSERT INTO idempotency_keys (key, fingerprint, state)
         VALUES ($1, $2, 'in-flight')
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [key, fingerprint],
      );

      if (claim.rowCount === 0) {
        const existing = await client.query(
          `SELECT fingerprint, state, response FROM idempotency_keys WHERE key = $1`,
          [key],
        );
        const rec = existing.rows[0] as { fingerprint: string; state: string; response: Order | null };

        if (rec.fingerprint !== fingerprint) {
          throw new AppError(422, 'This Idempotency-Key was already used with a different request body.', {
            code: 'idempotency-key-reuse',
          });
        }
        if (rec.state === 'in-flight') {
          throw new AppError(409, 'A request with this Idempotency-Key is still being processed — retry later.', {
            code: 'idempotency-in-flight',
          });
        }

        return { order: rec.response as Order, replay: true };
      }

      const userExists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [body.user_id]);

      if (userExists.rowCount === 0) {
        throw new AppError(422, `Unknown user id: ${body.user_id}.`, {
          code: 'user-not-found',
          errors: [
            {
              path: '/user_id',
              message: `User ${body.user_id} does not exist`,
              errorCode: 'user-not-found',
            },
          ],
        });
      }

      const ids = [...new Set(body.items.map((i) => i.product_id))];
      const found = await client.query(
        `SELECT id, price_cents, currency FROM products WHERE id = ANY($1::int[])`,
        [ids],
      );
      const byId = new Map(
        (found.rows as Array<{ id: number; price_cents: number; currency: string }>).map((p) => [p.id, p]),
      );
      const missing = ids.filter((id) => !byId.has(id));

      if (missing.length > 0) {
        throw new AppError(422, `Unknown product id(s): ${missing.join(', ')}.`, {
          code: 'product-not-found',
          errors: missing.map((id) => ({
            path: `/items/product_id/${id}`,
            message: `Product ${id} does not exist`,
            errorCode: 'product-not-found',
          })),
        });
      }

      const currencies = new Set([...byId.values()].map((p) => p.currency));

      if (currencies.size > 1) {
        throw new AppError(422, 'All items in an order must share a single currency.', {
          code: 'currency-mismatch',
        });
      }

      const currency = [...byId.values()][0].currency;

      let total = 0;
      const computed = body.items.map((i) => {
        const product = byId.get(i.product_id)!;
        const line = product.price_cents * i.quantity;

        total += line;

        return {
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price_cents: product.price_cents,
          line_total_cents: line,
        };
      });

      const inserted = await client.query(
        `INSERT INTO orders (user_id, currency, total_cents, status) VALUES ($1, $2, $3, 'new')
         RETURNING id, user_id, status, total_cents, currency, created_at`,
        [body.user_id, currency, total],
      );
      const orderRow = inserted.rows[0] as OrderRow;

      for (const item of computed) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, line_total_cents)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderRow.id, item.product_id, item.quantity, item.unit_price_cents, item.line_total_cents],
        );
      }

      const order: Order = this.assemble(
        orderRow,
        computed.map(({ product_id, quantity, line_total_cents }) => ({ product_id, quantity, line_total_cents })),
      );

      await client.query(`UPDATE idempotency_keys SET state = 'done', response = $2 WHERE key = $1`, [
        key,
        JSON.stringify(order),
      ]);

      return { order, replay: false };
    });
  }

  private async loadItems(orderIds: number[]): Promise<Map<number, OrderItem[]>> {
    const map = new Map<number, OrderItem[]>();

    if (orderIds.length === 0) return map;

    const { rows } = await this.db.query(
      `SELECT order_id, product_id, quantity, line_total_cents FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id ASC`,
      [orderIds],
    );

    for (const r of rows as Array<{ order_id: number } & OrderItem>) {
      const arr = map.get(r.order_id) ?? [];

      arr.push({ product_id: r.product_id, quantity: r.quantity, line_total_cents: r.line_total_cents });
      map.set(r.order_id, arr);
    }

    return map;
  }

  private assemble(row: OrderRow, items: OrderItem[]): Order {
    return {
      id: row.id,
      user_id: row.user_id,
      items,
      status: row.status,
      total_cents: row.total_cents,
      currency: row.currency,
      created_at: row.created_at,
    };
  }
}
