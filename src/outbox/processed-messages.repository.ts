import { Queryable } from '../common/queryable';

export class ProcessedMessagesRepository {
  async markProcessed(db: Queryable, messageId: string, consumer: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `INSERT INTO processed_messages (message_id, consumer)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING message_id`,
      [messageId, consumer],
    );

    return (rowCount ?? 0) > 0;
  }

  async count(db: Queryable, consumer: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM processed_messages WHERE consumer = $1`,
      [consumer],
    );

    return rows[0].n as number;
  }
}