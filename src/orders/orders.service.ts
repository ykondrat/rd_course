import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { AppError } from '../common/problem';
import { buildPage, Page } from '../common/pagination';
import { decodeCursor } from '../common/cursor';
import { Keyset } from '../products/products.repository';
import { OrderEventsService } from './order-events.service';
import { fingerprintOf, resolveIdempotency, writeOrderWithOutbox } from '../outbox/order-write';
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
    return this.createInTransaction(key, body);
  }

  private async createInTransaction(key: string, body: CreateOrderBody): Promise<CreateResult> {
    const fingerprint = fingerprintOf(body);

    return this.db.withTransaction(async (client) => {
      const outcome = await resolveIdempotency(client, key, fingerprint);

      if (outcome.replay) return { order: outcome.order, replay: true };

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

      const computed = body.items.map((i) => {
        const product = byId.get(i.product_id)!;

        return {
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price_cents: product.price_cents,
          line_total_cents: product.price_cents * i.quantity,
        };
      });

      const order = await writeOrderWithOutbox(client, key, {
        userId: body.user_id,
        currency,
        items: computed,
      });

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
