import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { DatabaseService } from '../database/database.service';
import { AppError } from '../common/problem';
import { buildPage, Page } from '../common/pagination';
import { decodeCursor } from '../common/cursor';
import { Keyset } from '../products/products.repository';
import { OrderEventsService } from './order-events.service';
import { OrderItemRow, OrderRow, OrdersRepository } from './orders.repository';

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

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersRepository,
    private readonly events: OrderEventsService,
  ) {}

  async list(limit: number, cursor?: string): Promise<Page<Order>> {
    const rows = await this.orders.listOrders(this.db, { limit: limit + 1, after: this.toKeyset(cursor) });
    const page = buildPage(rows, limit);
    const itemsByOrder = await this.loadItemsMap(page.items.map((o) => o.id));

    return {
      items: page.items.map((o) => this.assemble(o, itemsByOrder.get(o.id) ?? [])),
      next_cursor: page.next_cursor,
    };
  }

  async getById(id: number): Promise<Order> {
    const row = await this.orders.findOrderById(this.db, id);

    if (!row) throw new AppError(404, `Order ${id} not found`);

    const itemsByOrder = await this.loadItemsMap([id]);

    return this.assemble(row, itemsByOrder.get(id) ?? []);
  }

  async getOwnerId(id: number): Promise<number | null> {
    const row = await this.orders.findOrderById(this.db, id);

    return row ? row.user_id : null;
  }

  async updateStatus(id: number, status: string): Promise<Order> {
    await this.db.withTransaction(async (client) => {
      const updated = await this.orders.updateStatus(client, id, status);

      if (!updated) throw new AppError(404, `Order ${id} not found`);
    });

    const order = await this.getById(id);

    this.events.emit(order.id, order.status);

    return order;
  }

  async create(key: string, body: CreateOrderBody): Promise<CreateResult> {
    const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    return this.db.withTransaction(async (client) => {
      const claimed = await this.orders.claimIdempotencyKey(client, key, fingerprint);

      if (!claimed) {
        const rec = await this.orders.findIdempotencyKey(client, key);

        if (rec && rec.fingerprint !== fingerprint) {
          throw new AppError(422, 'This Idempotency-Key was already used with a different request body.', {
            code: 'idempotency-key-reuse',
          });
        }
        if (rec && rec.state === 'in-flight') {
          throw new AppError(409, 'A request with this Idempotency-Key is still being processed — retry later.', {
            code: 'idempotency-in-flight',
          });
        }

        return { order: rec!.response as Order, replay: true };
      }

      if (!(await this.orders.userExists(client, body.user_id))) {
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
      const found = await this.orders.findProductsByIds(client, ids);
      const byId = new Map(found.map((p) => [p.id, p]));
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

      const orderRow = await this.orders.insertOrder(client, {
        user_id: body.user_id,
        currency,
        total_cents: total,
      });

      for (const item of computed) {
        await this.orders.insertOrderItem(client, { order_id: orderRow.id, ...item });
      }

      const order: Order = this.assemble(
        orderRow,
        computed.map(({ product_id, quantity, line_total_cents }) => ({ product_id, quantity, line_total_cents })),
      );

      await this.orders.markKeyDone(client, key, order);

      return { order, replay: false };
    });
  }

  private async loadItemsMap(orderIds: number[]): Promise<Map<number, OrderItem[]>> {
    const map = new Map<number, OrderItem[]>();

    if (orderIds.length === 0) return map;

    const rows: OrderItemRow[] = await this.orders.loadItems(this.db, orderIds);

    for (const r of rows) {
      const arr = map.get(r.order_id) ?? [];

      arr.push({ product_id: r.product_id, quantity: r.quantity, line_total_cents: r.line_total_cents });
      map.set(r.order_id, arr);
    }

    return map;
  }

  private toKeyset(cursor?: string): Keyset | undefined {
    if (!cursor) return undefined;

    const { c, id } = decodeCursor(cursor);

    return { createdAt: c, id };
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
