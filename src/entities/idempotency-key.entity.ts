import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'text' })
  fingerprint: string;

  @Column({ type: 'text' })
  state: string;

  @Column({ type: 'jsonb', nullable: true })
  response: unknown | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}