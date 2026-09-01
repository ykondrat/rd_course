import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { AppError } from '../common/problem';
import { buildPage, Page } from '../common/pagination';
import { decodeCursor } from '../common/cursor';

interface ProductRow {
  id: number;
  title: string;
  price_cents: number;
  currency: string;
  sku: string;
  description: string | null;
  created_at: string;
}

export interface Product {
  id: number;
  title: string;
  price_cents: number;
  currency: string;
  sku: string;
  description?: string;
  created_at: string;
}

const COLS = 'id, title, price_cents, currency, sku, description, created_at';

@Injectable()
export class ProductsService {
  constructor(private readonly db: DatabaseService) {}

  async list(limit: number, cursor?: string): Promise<Page<Product>> {
    const params: unknown[] = [];
    let where = '';

    if (cursor) {
      const { c, id } = decodeCursor(cursor);

      params.push(c, id);
      where = 'WHERE (created_at, id) < ($1, $2)';
    }

    params.push(limit + 1);

    const sql = `SELECT ${COLS} FROM products ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    const { rows } = await this.db.query(sql, params);
    const page = buildPage(rows as ProductRow[], limit);

    return { items: page.items.map((r) => this.serialize(r)), next_cursor: page.next_cursor };
  }

  async getById(id: number): Promise<Product> {
    const { rows } = await this.db.query(`SELECT ${COLS} FROM products WHERE id = $1`, [id]);

    if (rows.length === 0) throw new AppError(404, `Product ${id} not found`);

    return this.serialize(rows[0] as ProductRow);
  }

  async create(dto: {
    title: string;
    price_cents: number;
    currency: string;
    sku: string;
    description?: string;
  }): Promise<Product> {
    const { rows } = await this.db.query(
      `INSERT INTO products (title, price_cents, currency, sku, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLS}`,
      [dto.title, dto.price_cents, dto.currency, dto.sku, dto.description ?? null],
    );

    return this.serialize(rows[0] as ProductRow);
  }

  async patch(id: number, dto: Record<string, unknown>): Promise<Product> {
    const allowed = ['title', 'price_cents', 'currency', 'sku', 'description'];
    const sets: string[] = [];
    const params: unknown[] = [];

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(dto, key)) {
        params.push(dto[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }

    if (sets.length === 0) throw new AppError(400, 'No updatable fields were provided.');

    params.push(id);

    const { rows } = await this.db.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLS}`,
      params,
    );

    if (rows.length === 0) throw new AppError(404, `Product ${id} not found`);

    return this.serialize(rows[0] as ProductRow);
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
