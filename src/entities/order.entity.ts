import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { bigintToNumber } from './columns';
import { OrderItem } from './order-item.entity';
import { User } from './user.entity';

@Entity('orders')
@Check('orders_currency_check', "currency ~ '^[A-Z]{3}$'")
@Check('orders_total_cents_check', '"total_cents" >= 0')
@Check('orders_status_check', "status IN ('new', 'paid', 'shipped')")
@Index('orders_user_created_idx', ['user', 'createdAt'])
export class Order {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'text' })
  currency: string;

  @Column({ type: 'bigint', name: 'total_cents', transformer: bigintToNumber })
  totalCents: number;

  @Column({ type: 'text', default: 'new' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];
}