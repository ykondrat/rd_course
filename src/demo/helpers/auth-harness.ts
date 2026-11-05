import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { hashPassword } from '../../auth/password';
import { Queryable } from '../../common/queryable';
import { DatabaseService } from '../../database/database.service';
import { configureApp } from '../../main';

export const DEV_PASSWORD = 'demo-password-123';

export interface BootedApp {
  app: INestApplication;
  baseUrl: string;
  db: DatabaseService;
}

export async function bootApp(): Promise<BootedApp> {
  const app = await NestFactory.create(AppModule, { logger: false });

  configureApp(app);
  await app.listen(0);

  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const db = app.get(DatabaseService);

  return { app, baseUrl, db };
}

export interface SeededUser {
  id: number;
  email: string;
}
export interface SeededWorld {
  buyer: SeededUser;
  buyer2: SeededUser;
  seller: SeededUser;
  admin: SeededUser;
  orderId: number;
}

export async function seedWorld(db: Queryable): Promise<SeededWorld> {
  await db.query(`TRUNCATE refresh_tokens, access_denylist`);

  const passwordHash = hashPassword(DEV_PASSWORD);

  const upsert = async (email: string, role: string): Promise<SeededUser> => {
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, role, password_hash, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE
         SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, is_active = true
       RETURNING id`,
      [email, email, role, passwordHash],
    );

    return { id: Number(rows[0].id), email };
  };

  const buyer = await upsert('buyer@demo.test', 'customer');
  const buyer2 = await upsert('buyer2@demo.test', 'customer');
  const seller = await upsert('seller@demo.test', 'seller');
  const admin = await upsert('admin@demo.test', 'admin');

  const order = await db.query(
    `INSERT INTO orders (user_id, currency, total_cents, status) VALUES ($1, 'USD', 0, 'new') RETURNING id`,
    [buyer.id],
  );

  return { buyer, buyer2, seller, admin, orderId: Number(order.rows[0].id) };
}

export async function authedFetch(
  url: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};

  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  return fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export async function login(baseUrl: string, email: string): Promise<{ access: string; refresh: string }> {
  const res = await authedFetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { email, password: DEV_PASSWORD },
  });
  const body = (await res.json()) as { access_token: string; refresh_token: string };

  return { access: body.access_token, refresh: body.refresh_token };
}

export function forgeAdmin(accessToken: string): string {
  const [header, payload, signature] = accessToken.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;

  claims.role = 'admin';

  const tampered = Buffer.from(JSON.stringify(claims)).toString('base64url');

  return `${header}.${tampered}.${signature}`;
}