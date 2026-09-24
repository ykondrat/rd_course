import 'reflect-metadata';
import { join } from 'node:path';

import { DataSource, DataSourceOptions } from 'typeorm';

import { loadEnv } from './config/env.schema';
import {
  IdempotencyKey,
  Order,
  OrderItem,
  Product,
  Task,
  User,
} from './entities';

const env = loadEnv();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: env.PGHOST,
  port: env.PGPORT,
  username: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  entities: [User, Product, Order, OrderItem, IdempotencyKey, Task],
  migrations: [join(__dirname, 'migrations', '*.js')],
  synchronize: false,
};

export const AppDataSource = new DataSource(dataSourceOptions);
