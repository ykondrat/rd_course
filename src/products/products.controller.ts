import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.products.list(limit === undefined ? 20 : Number(limit), cursor);
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.products.getById(id);
  }

  @Post()
  async create(
    @Body() body: { title: string; price_cents: number; currency: string; sku: string; description?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const product = await this.products.create(body);

    res.status(201).setHeader('Location', `/products/${product.id}`);

    return product;
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.products.patch(id, body);
  }
}
