import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ChannelModel, ConfirmChannel } from 'amqplib';

import { body, connect, withConfirmChannel, X } from './amqp';
import type { OrderPlacedEvent } from './order-placed.event';

export async function publishOrderPlacedEvents(events: OrderPlacedEvent[]): Promise<void> {
  await withConfirmChannel(async (ch) => {
    for (const event of events) {
      ch.publish(X.events, event.type, body(event), {
        persistent: true,
        messageId: event.eventId,
        contentType: 'application/json',
      });
    }

    await ch.waitForConfirms();
  });
}

@Injectable()
export class OrderPlacedPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(OrderPlacedPublisher.name);
  private conn: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  async publish(event: OrderPlacedEvent): Promise<void> {
    const channel = await this.ensureChannel();

    await new Promise<void>((resolve, reject) => {
      channel.publish(
        X.events,
        event.type,
        body(event),
        { persistent: true, messageId: event.eventId, contentType: 'application/json' },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;

    try {
      this.conn = await connect();
      this.conn.on('error', (err) => this.logger.warn(`broker connection error: ${err.message}`));
      this.conn.on('close', () => this.reset());
      this.channel = await this.conn.createConfirmChannel();

      return this.channel;
    } catch (err) {
      await this.reset();
      throw err;
    }
  }

  private async reset(): Promise<void> {
    const conn = this.conn;

    this.channel = null;
    this.conn = null;

    await conn?.close().catch(() => {});
  }

  async onModuleDestroy(): Promise<void> {
    await this.reset();
  }
}
