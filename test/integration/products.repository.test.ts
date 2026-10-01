import 'reflect-metadata';

import { PoolClient } from 'pg';

import { PgHandle, startPg } from './testkit/pg-container';
import { aProduct } from './testkit/builders';
import { ProductsRepository } from '../../src/products/products.repository';

describe('ProductsRepository (integration, testcontainers + ROLLBACK)', () => {
  let pg: PgHandle;
  let client: PoolClient;
  const repo = new ProductsRepository();

  beforeAll(async () => {
    pg = await startPg('(products)');
  });

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    client = await pg.pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  it('inserts a product and reads it back (round-trip against a real DB)', async () => {
    const created = await aProduct().withSku('SKU-ROUNDTRIP').insertVia(repo, client);
    const found = await repo.findById(client, created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.sku).toBe('SKU-ROUNDTRIP');
    expect(typeof found!.id).toBe('number');
  });

  it('violates UNIQUE(sku): a second product with the same sku → Postgres error 23505', async () => {
    await aProduct().withSku('DUPLICATE-SKU').insertVia(repo, client);

    await expect(aProduct().withSku('DUPLICATE-SKU').insertVia(repo, client)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('list returns newest first (ORDER BY created_at DESC, id DESC)', async () => {
    const a = await aProduct().insertVia(repo, client);
    const b = await aProduct().insertVia(repo, client);
    const c = await aProduct().insertVia(repo, client);
    const rows = await repo.list(client, { limit: 10 });

    expect(rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  it('patch updates only the given fields (dynamic UPDATE ... RETURNING)', async () => {
    const created = await aProduct().withTitle('Old title').withPriceCents(1000).insertVia(repo, client);
    const updated = await repo.update(client, created.id, [{ column: 'title', value: 'New title' }]);

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('New title');
    expect(updated!.price_cents).toBe(1000);
  });
});
