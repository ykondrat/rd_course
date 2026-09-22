import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text', name: 'full_name' })
  fullName: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];
}