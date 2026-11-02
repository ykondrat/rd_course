import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PgHandle, startPg } from '../integration/testkit/pg-container';
import { applyContainerEnv } from '../integration/testkit/app-env';
import { hashPassword } from '../../src/auth/password';

describe('Orders E2E (auth + supertest against the full AppModule + testcontainers)', () => {
  let pg: PgHandle;
  let app: INestApplication;

  const PASSWORD = 'e2e-password';

  beforeAll(async () => {
    pg = await startPg('(e2e)');

    applyContainerEnv(pg.connection);

    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/main');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = configureApp(moduleRef.createNestApplication());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  async function seedUser(email: string, role: string): Promise<void> {
    await pg.pool.query(
      `INSERT INTO users (email, full_name, role, password_hash, is_active) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash`,
      [email, email, role, hashPassword(PASSWORD)],
    );
  }

  async function tokenFor(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);

    return res.body.access_token as string;
  }

  it('happy path: seller creates a product, buyer places and reads their own order', async () => {
    await seedUser('seller-e2e@test', 'seller');
    await seedUser('buyer-e2e@test', 'customer');

    const sellerToken = await tokenFor('seller-e2e@test');
    const buyerToken = await tokenFor('buyer-e2e@test');

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title: 'E2E Product', price_cents: 2500, currency: 'USD', sku: `E2E-${Date.now()}` })
      .expect(201);
    const productId = productRes.body.id as number;

    const orderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', `e2e-${Date.now()}`)
      .send({ items: [{ product_id: productId, quantity: 2 }] })
      .expect(201);
    const orderId = orderRes.body.id as number;

    const readRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(readRes.body.id).toBe(orderId);
    expect(readRes.body.total_cents).toBe(5000);
    expect(readRes.body.items).toHaveLength(1);
    expect(readRes.body.items[0].line_total_cents).toBe(5000);
  });

  it('unauthenticated create → 401 (application/problem+json)', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', `e2e-noauth-${Date.now()}`)
      .send({ items: [{ product_id: 1, quantity: 1 }] })
      .expect(401);

    expect(res.body.status).toBe(401);
    expect(res.body.title).toBe('Unauthorized');
  });

  it('a valid token reading a non-existent order → 404', async () => {
    await seedUser('buyer404-e2e@test', 'customer');
    const token = await tokenFor('buyer404-e2e@test');

    const res = await request(app.getHttpServer())
      .get('/orders/999999')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body.status).toBe(404);
    expect(res.body.title).toBe('Not Found');
  });
});