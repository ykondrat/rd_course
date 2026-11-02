import { Queryable } from '../common/queryable';

export interface ProductCard {
  id: number;
  title: string;
  price_cents: number;
  currency: string;
  sku: string;
  description: string | null;
  stock: number;
  rating_avg: number | null;
  review_count: number;
  created_at: string;
}

let dbCalls = 0;

export const getDbCalls = (): number => dbCalls;

export const resetDbCalls = (): void => {
  dbCalls = 0;
};

export async function loadProductProjection(db: Queryable, id: number): Promise<ProductCard | null> {
  dbCalls += 1;

  const { rows } = await db.query(
    `SELECT p.id, p.title, p.price_cents, p.currency, p.sku, p.description, p.stock, p.created_at,
            AVG(r.rating)::float8 AS rating_avg,
            COUNT(r.id)::int      AS review_count
       FROM products p
       LEFT JOIN reviews r ON r.product_id = p.id
      WHERE p.id = $1
      GROUP BY p.id`,
    [id],
  );

  if (rows.length === 0) return null;

  const row = rows[0] as Record<string, unknown>;

  return {
    id: Number(row.id),
    title: String(row.title),
    price_cents: Number(row.price_cents),
    currency: String(row.currency),
    sku: String(row.sku),
    description: row.description == null ? null : String(row.description),
    stock: Number(row.stock),
    rating_avg: row.rating_avg == null ? null : Number(row.rating_avg),
    review_count: Number(row.review_count),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}