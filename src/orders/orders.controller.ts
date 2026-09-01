import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { CreateOrderBody, OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

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
}
