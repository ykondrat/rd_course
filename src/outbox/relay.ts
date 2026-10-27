import { PoolClient } from 'pg';

import { pool } from '../lib/db';
import { body, RK, withConfirmChannel, X } from '../messaging/amqp';
import { OutboxRepository } from './outbox.repository';

const outboxRepo = new OutboxRepository();

const BATCH = 10;

export interface RelayOptions {
  abortBeforeUpdate?: boolean;
}

export async function relayOnce(opts: RelayOptions = {}): Promise<number> {
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    const rows = await outboxRepo.claimUnpublished(client, BATCH);

    if (rows.length === 0) {
      await client.query('COMMIT');

      return 0;
    }

    const ids = rows.map((row) => row.id);

    try {
      await withConfirmChannel(async (ch) => {
        for (const row of rows) {
          const event = row.payload;

          ch.publish(X.events, RK.orderPlaced, body(event), {
            persistent: true,
            messageId: event.eventId,
            contentType: 'application/json',
          });
        }

        await ch.waitForConfirms();
      });
    } catch (publishError) {
      await client.query('ROLLBACK').catch(() => undefined);
      await outboxRepo.recordAttempt(pool, ids);

      throw publishError;
    }

    if (opts.abortBeforeUpdate) {
      throw new Error('relay died between publish and UPDATE published_at');
    }

    await outboxRepo.markPublished(client, ids);
    await client.query('COMMIT');

    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);

    throw error;
  } finally {
    client.release();
  }
}

export async function runRelay(opts: { pollMs: number; stop?: () => boolean }): Promise<void> {
  for (;;) {
    if (opts.stop?.()) return;

    const published = await relayOnce();

    if (published === 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
    }
  }
}