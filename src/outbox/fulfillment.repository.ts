import { Queryable } from '../common/queryable';

export class FulfillmentRepository {
  async apply(db: Queryable, orderId: number): Promise<void> {
    await db.query(
      `INSERT INTO order_fulfillments (order_id)
       VALUES ($1)
       ON CONFLICT (order_id) DO NOTHING`,
      [orderId],
    );
  }

  async count(db: Queryable): Promise<number> {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM order_fulfillments`);

    return rows[0].n as number;
  }
}