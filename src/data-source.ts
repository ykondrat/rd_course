import 'reflect-metadata';

import { DataSource, DataSourceOptions } from 'typeorm';

import { loadEnv } from './config/env.schema';
import {
  IdempotencyKey,
  Order,
  OrderItem,
  Product,
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
  entities: [User, Product, Order, OrderItem, IdempotencyKey],
  migrations: ['dist/migrations/*.js'],
  synchronize: false,
};

export const AppDataSource = new DataSource(dataSourceOptions);
