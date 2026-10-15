import { Module } from '@nestjs/common';

import { MessagingModule } from '../messaging/messaging.module';
import { OrdersController } from './orders.controller';
import { OrderEventsService } from './order-events.service';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';

@Module({
  imports: [MessagingModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, OrderEventsService, OrdersGateway],
})
export class OrdersModule {}
