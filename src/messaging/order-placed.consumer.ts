import type { Channel, ConsumeMessage } from 'amqplib';

import { parse, Q } from './amqp';
import { applyEffect, remember, seen } from './effects';
import type { OrderPlacedEvent } from './order-placed.event';

export type Disposition = 'ack' | 'requeue' | 'reject';

export type DeliveryHandler = (
  event: OrderPlacedEvent,
  msg: ConsumeMessage,
) => Disposition | Promise<Disposition>;

export interface ConsumeOptions {
  prefetch: number;
  queue?: string;
}

export async function startConsumer(
  ch: Channel,
  handle: DeliveryHandler,
  options: ConsumeOptions,
): Promise<string> {
  await ch.prefetch(options.prefetch);

  const { consumerTag } = await ch.consume(
    options.queue ?? Q.orderPlaced,
    (msg) => {
      if (msg === null) return;

      void dispatch(ch, handle, msg);
    },
    { noAck: false },
  );

  return consumerTag;
}

async function dispatch(ch: Channel, handle: DeliveryHandler, msg: ConsumeMessage): Promise<void> {
  const event = parse<OrderPlacedEvent>(msg.content);
  const disposition = await handle(event, msg);

  if (disposition === 'ack') ch.ack(msg);
  else if (disposition === 'requeue') ch.nack(msg, false, true);
  else ch.reject(msg, false);
}

export interface EffectOutcome {
  applied: boolean;
}

export function idempotentEffect(
  effectsFile: string,
  processedFile: string,
): (event: OrderPlacedEvent) => EffectOutcome {
  return (event) => {
    if (seen(processedFile, event.eventId)) return { applied: false };

    remember(processedFile, event.eventId);
    applyEffect(effectsFile, event.eventId, event.data);

    return { applied: true };
  };
}
