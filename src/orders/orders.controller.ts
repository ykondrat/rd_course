import { Body, Controller, Get, Headers, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { filter } from 'rxjs';

import { OrderEvent, OrderEventsService } from './order-events.service';
import { CreateOrderBody, OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.orders.list(limit === undefined ? 20 : Number(limit), cursor);
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.orders.getById(id);
  }

  @Post()
  async create(
    @Headers('idempotency-key') key: string,
    @Body() body: CreateOrderBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, replay } = await this.orders.create(key, body);

    res.status(201).setHeader('Location', `/orders/${order.id}`);

    if (replay) res.setHeader('Idempotency-Replay', 'true');

    return order;
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status: string }) {
    return this.orders.updateStatus(id, body.status);
  }

  @Get(':id/events')
  streamEvents(
    @Param('id', ParseIntPipe) id: number,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() res: Response,
  ): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    const write = (e: OrderEvent): void => {
      res.write(`id: ${e.id}\nevent: order.status\ndata: ${JSON.stringify(e)}\n\n`);
    };

    for (const e of this.events.replay(id, Number(lastEventId ?? 0))) write(e);

    const sub = this.events.stream().pipe(filter((e) => e.orderId === id)).subscribe(write);

    res.on('close', () => sub.unsubscribe());
  }
}
