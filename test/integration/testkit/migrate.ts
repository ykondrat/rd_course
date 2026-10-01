import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { User, Product, Order, OrderItem, IdempotencyKey, Task } from '../../../src/entities';
import { InitialSchema1789970515364 } from '../../../src/migrations/1789970515364-InitialSchema';
import { AddProductSkuUnique1790083904530 } from '../../../src/migrations/1790083904530-AddProductSkuUnique';
import { AddConcurrencyStockBalanceTasks1790084975962 } from '../../../src/migrations/1790084975962-AddConcurrencyStockBalanceTasks';

export interface DbConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export async function applyMigrations(conn: DbConnection): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password,
    database: conn.database,
    entities: [User, Product, Order, OrderItem, IdempotencyKey, Task],
    migrations: [
      InitialSchema1789970515364,
      AddProductSkuUnique1790083904530,
      AddConcurrencyStockBalanceTasks1790084975962,
    ],
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
