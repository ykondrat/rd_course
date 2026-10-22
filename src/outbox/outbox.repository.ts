import { Injectable } from '@nestjs/common';

import { Queryable } from '../common/queryable';
import { OrderPlacedEvent } from '../messaging/order-placed.event';

export interface OutboxRow {
  id: string;
  type: string;
  payload: OrderPlacedEvent;
}

@Injectable()
export class OutboxRepository {
  async insert(db: Queryable, event: OrderPlacedEvent): Promise<void> {
    await db.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, type, payload)
       VALUES ('order', $1, $2, $3)`,
      [String(event.data.orderId), event.type, JSON.stringify(event)],
    );
  }

  async claimUnpublished(db: Queryable, limit: number): Promise<OutboxRow[]> {
    const { rows } = await db.query(
      `SELECT id, type, payload
         FROM outbox
        WHERE published_at IS NULL
        ORDER BY created_at, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    return rows as OutboxRow[];
  }

  async markPublished(db: Queryable, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await db.query(
      `UPDATE outbox SET published_at = now(), attempts = attempts + 1
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async countAll(db: Queryable): Promise<number> {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM outbox`);

    return rows[0].n as number;
  }

  async countPublished(db: Queryable): Promise<number> {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM outbox WHERE published_at IS NOT NULL`,
    );

    return rows[0].n as number;
  }
}