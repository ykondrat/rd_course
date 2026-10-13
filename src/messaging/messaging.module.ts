import { Module } from '@nestjs/common';

import { OrderPlacedPublisher } from './order-placed.publisher';

@Module({
  providers: [OrderPlacedPublisher],
  exports: [OrderPlacedPublisher],
})
export class MessagingModule {}
