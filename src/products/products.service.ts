import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { AppError } from '../common/problem';
import { buildPage, Page } from '../common/pagination';
import { decodeCursor } from '../common/cursor';
import { Keyset, ProductRow, ProductsRepository, UpdateField } from './products.repository';

export interface Product {
  id: number;
  title: string;
  price_cents: number;
  currency: string;
  sku: string;
  description?: string;
  created_at: string;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsRepository,
  ) {}

  async list(limit: number, cursor?: string): Promise<Page<Product>> {
    const rows = await this.products.list(this.db, { limit: limit + 1, after: this.toKeyset(cursor) });
    const page = buildPage(rows, limit);

    return { items: page.items.map((r) => this.serialize(r)), next_cursor: page.next_cursor };
  }

  async getById(id: number): Promise<Product> {
    const row = await this.products.findById(this.db, id);

    if (!row) throw new AppError(404, `Product ${id} not found`);

    return this.serialize(row);
  }

  async create(dto: {
    title: string;
    price_cents: number;
    currency: string;
    sku: string;
    description?: string;
  }): Promise<Product> {
    return this.serialize(await this.products.insert(this.db, dto));
  }

  async patch(id: number, dto: Record<string, unknown>): Promise<Product> {
    const allowed = ['title', 'price_cents', 'currency', 'sku', 'description'];
    const fields: UpdateField[] = allowed
      .filter((key) => Object.prototype.hasOwnProperty.call(dto, key))
      .map((key) => ({ column: key, value: dto[key] }));

    if (fields.length === 0) throw new AppError(400, 'No updatable fields were provided.');

    const row = await this.products.update(this.db, id, fields);

    if (!row) throw new AppError(404, `Product ${id} not found`);

    return this.serialize(row);
  }

  private toKeyset(cursor?: string): Keyset | undefined {
    if (!cursor) return undefined;

    const { c, id } = decodeCursor(cursor);

    return { createdAt: c, id };
  }

  private serialize(row: ProductRow): Product {
    const product: Product = {
      id: row.id,
      title: row.title,
      price_cents: row.price_cents,
      currency: row.currency,
      sku: row.sku,
      created_at: row.created_at,
    };

    if (row.description != null) product.description = row.description;

    return product;
  }
}
