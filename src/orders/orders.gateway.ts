import { OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { OrderEventsService } from './order-events.service';
import { OrdersService } from './orders.service';

@WebSocketGateway()
export class OrdersGateway implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

  onModuleInit(): void {
    this.events.stream().subscribe((e) => this.server.to(`orders:${e.orderId}`).emit('order.status', e));
  }

  handleConnection(client: Socket): void {
    console.log(`+ ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    console.log(`- ${client.id}`);
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId: number; userId: number },
  ): Promise<WsResponse<{ room?: string; error?: string }>> {
    const ownerId = await this.orders.getOwnerId(body.orderId);

    if (ownerId === null || ownerId !== body.userId) {
      return { event: 'join:denied', data: { error: `order ${body.orderId} is not yours` } };
    }

    const room = `orders:${body.orderId}`;

    await client.join(room);

    console.log(`  ${client.id} → кімната «${room}»`);

    return { event: 'joined', data: { room } };
  }
}
