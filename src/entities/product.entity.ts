import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { bigintToNumber } from './columns';
import { OrderItem } from './order-item.entity';

@Entity('products')
@Check('products_price_cents_check', '"price_cents" >= 0')
@Check('products_currency_check', "currency ~ '^[A-Z]{3}$'")
export class Product {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'bigint', name: 'price_cents', transformer: bigintToNumber })
  priceCents: number;

  @Column({ type: 'text' })
  currency: string;

  @Column({ type: 'text', unique: true })
  sku: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems: OrderItem[];
}