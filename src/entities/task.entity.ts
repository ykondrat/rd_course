import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity';

@Entity('tasks')
@Check('tasks_status_check', "status IN ('pending', 'done', 'failed')")
@Check('tasks_processed_check', '"processed" >= 0')
@Index('tasks_status_idx', ['status'])
export class Task {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: unknown | null;

  @Column({ type: 'text', default: 'pending' })
  status: string;

  @Column({ type: 'int', default: 0 })
  processed: number;

  @Column({ type: 'text', name: 'worker_id', nullable: true })
  workerId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt: Date | null;
}
