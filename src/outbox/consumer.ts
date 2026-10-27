import type { Channel } from 'amqplib';

import { transaction } from '../lib/db';
import { Disposition, startConsumer } from '../messaging/order-placed.consumer';
import { FulfillmentRepository } from './fulfillment.repository';
import { ProcessedMessagesRepository } from './processed-messages.repository';

export const CONSUMER = 'order-fulfillment';

export interface ConsumerCounters {
  deliveries: number;
  applied: number;
  skipped: number;
}

const processedRepo = new ProcessedMessagesRepository();
const fulfillmentRepo = new FulfillmentRepository();

export async function startFulfillmentConsumer(
  ch: Channel,
  counters: ConsumerCounters,
  prefetch: number,
): Promise<string> {
  return startConsumer(
    ch,
    async (event): Promise<Disposition> => {
      counters.deliveries += 1;

      await transaction(async (client) => {
        const firstTime = await processedRepo.markProcessed(client, event.eventId, CONSUMER);

        if (!firstTime) {
          counters.skipped += 1;

          return;
        }

        await fulfillmentRepo.apply(client, event.data.orderId);
        counters.applied += 1;
      });

      return 'ack';
    },
    { prefetch },
  );
}