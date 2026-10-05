import { Injectable } from '@nestjs/common';

import { Queryable } from '../common/queryable';

export interface ProductRow {
  id: number;
  title: string;
  price_cents: number;
  currency: string;
  sku: string;
  description: string | null;
  created_at: string;
}

export interface Keyset {
  createdAt: string;
  id: number;
}

export interface UpdateField {
  column: string;
  value: unknown;
}

const COLS = 'id, title, price_cents, currency, sku, description, created_at';

@Injectable()
export class ProductsRepository {
  async insert(
    db: Queryable,
    dto: { title: string; price_cents: number; currency: string; sku: string; description?: string },
  ): Promise<ProductRow> {
    const { rows } = await db.query(
      `INSERT INTO products (title, price_cents, currency, sku, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLS}`,
      [dto.title, dto.price_cents, dto.currency, dto.sku, dto.description ?? null],
    );

    return rows[0] as ProductRow;
  }

  async findById(db: Queryable, id: number): Promise<ProductRow | null> {
    const { rows } = await db.query(`SELECT ${COLS} FROM products WHERE id = $1`, [id]);

    return (rows[0] as ProductRow) ?? null;
  }

  async list(db: Queryable, opts: { limit: number; after?: Keyset }): Promise<ProductRow[]> {
    const params: unknown[] = [];
    let where = '';

    if (opts.after) {
      params.push(opts.after.createdAt, opts.after.id);
      where = 'WHERE (created_at, id) < ($1, $2)';
    }

    params.push(opts.limit);

    const { rows } = await db.query(
      `SELECT ${COLS} FROM products ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );

    return rows as ProductRow[];
  }

  async update(db: Queryable, id: number, fields: ReadonlyArray<UpdateField>): Promise<ProductRow | null> {
    const sets = fields.map((f, i) => `${f.column} = $${i + 1}`);
    const params = [...fields.map((f) => f.value), id];
    const { rows } = await db.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLS}`,
      params,
    );

    return (rows[0] as ProductRow) ?? null;
  }
}
