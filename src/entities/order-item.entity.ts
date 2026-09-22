import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { bigintToNumber } from './columns';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity('order_items')
@Check('order_items_quantity_check', 'quantity >= 1')
@Check('order_items_unit_price_cents_check', '"unit_price_cents" >= 0')
@Check('order_items_line_total_cents_check', '"line_total_cents" >= 0')
export class OrderItem {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @ManyToOne(() => Order, (order) => order.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => Product, (product) => product.orderItems, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'bigint', name: 'unit_price_cents', transformer: bigintToNumber })
  unitPriceCents: number;

  @Column({ type: 'bigint', name: 'line_total_cents', transformer: bigintToNumber })
  lineTotalCents: number;
}