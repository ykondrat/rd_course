import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PgHandle, startPg } from '../integration/testkit/pg-container';
import { applyContainerEnv } from '../integration/testkit/app-env';
import { aUser } from '../integration/testkit/builders';

describe('Orders E2E (supertest against the full AppModule + testcontainers)', () => {
  let pg: PgHandle;
  let app: INestApplication;

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

  it('happy path: create a product → create an order → read the order', async () => {
    const user = await aUser().insertVia(pg.pool);
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .send({ title: 'E2E Product', price_cents: 2500, currency: 'USD', sku: `E2E-${Date.now()}` })
      .expect(201);
    const productId = productRes.body.id as number;

    expect(productId).toEqual(expect.any(Number));

    const orderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', `e2e-${Date.now()}`)
      .send({ user_id: user.id, items: [{ product_id: productId, quantity: 2 }] })
      .expect(201);

    const orderId = orderRes.body.id as number;
    const readRes = await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(200);

    expect(readRes.body.id).toBe(orderId);
    expect(readRes.body.total_cents).toBe(5000);
    expect(readRes.body.items).toHaveLength(1);
    expect(readRes.body.items[0].line_total_cents).toBe(5000);
  });

  it('negative case: GET a non-existent order → 404 (application/problem+json)', async () => {
    const res = await request(app.getHttpServer()).get('/orders/999999').expect(404);

    expect(res.body.status).toBe(404);
    expect(res.body.type).toBeDefined();
    expect(res.body.title).toBe('Not Found');
  });
});
