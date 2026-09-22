import 'reflect-metadata';

import { EntityManager } from 'typeorm';

import { AppDataSource } from './data-source';
import {
  IdempotencyKey,
  Order,
  OrderItem,
  Product,
  User,
} from './entities';

const PRODUCTS: Array<Pick<Product, 'title' | 'priceCents' | 'currency' | 'sku' | 'description'>> = [
  { title: 'Mechanical Keyboard', priceCents: 120_00, currency: 'USD', sku: 'SKU-000001', description: 'Tactile switches' },
  { title: 'Wireless Mouse', priceCents: 45_00, currency: 'USD', sku: 'SKU-000002', description: 'Ergonomic' },
  { title: '27" Monitor', priceCents: 780_00, currency: 'USD', sku: 'SKU-000003', description: '4K IPS' },
  { title: 'Laptop 14"', priceCents: 4_200_00, currency: 'USD', sku: 'SKU-000004', description: 'Ultrabook' },
  { title: 'USB-C Hub', priceCents: 89_00, currency: 'USD', sku: 'SKU-000005', description: '7-in-1' },
  { title: 'Webcam 1080p', priceCents: 60_00, currency: 'USD', sku: 'SKU-000006', description: 'Auto-focus' },
  { title: 'Desk Lamp', priceCents: 35_00, currency: 'USD', sku: 'SKU-000007', description: 'Dimmable' },
  { title: 'Noise-cancelling Headset', priceCents: 210_00, currency: 'USD', sku: 'SKU-000008', description: 'Over-ear' },
  { title: 'Standing Desk', priceCents: 560_00, currency: 'USD', sku: 'SKU-000009', description: 'Electric' },
  { title: 'Office Chair', priceCents: 320_00, currency: 'USD', sku: 'SKU-000010', description: 'Lumbar support' },
];

const USER_COUNT = 8;
const ORDER_COUNT = 12;
const IDEMPOTENCY_COUNT = 5;

async function seed(em: EntityManager): Promise<void> {
  await em.query(
    'TRUNCATE order_items, orders, products, users, idempotency_keys RESTART IDENTITY CASCADE',
  );

  const users = await em.getRepository(User).save(
    Array.from({ length: USER_COUNT }, (_, i) =>
      em.getRepository(User).create({
        email: `user${i + 1}@example.com`,
        fullName: `User ${i + 1}`,
      }),
    ),
  );

  const products = await em.getRepository(Product).save(
    PRODUCTS.map((p) => em.getRepository(Product).create(p)),
  );

  const orders: Order[] = [];

  for (let i = 0; i < ORDER_COUNT; i++) {
    const user = users[i % users.length];
    const a = products[i % products.length];
    const b = products[(i + 3) % products.length];

    const qtyA = (i % 3) + 1;
    const itemA = em.getRepository(OrderItem).create({
      product: a,
      quantity: qtyA,
      unitPriceCents: a.priceCents,
      lineTotalCents: a.priceCents * qtyA,
    });
    const itemB = em.getRepository(OrderItem).create({
      product: b,
      quantity: 1,
      unitPriceCents: b.priceCents,
      lineTotalCents: b.priceCents,
    });

    orders.push(
      em.getRepository(Order).create({
        user,
        currency: 'USD',
        totalCents: itemA.lineTotalCents + itemB.lineTotalCents,
        status: i % 4 === 0 ? 'shipped' : i % 3 === 0 ? 'paid' : 'new',
        items: [itemA, itemB],
      }),
    );
  }

  await em.getRepository(Order).save(orders);

  await em.getRepository(IdempotencyKey).save(
    Array.from({ length: IDEMPOTENCY_COUNT }, (_, i) =>
      em.getRepository(IdempotencyKey).create({
        key: `seed-key-${i + 1}`,
        fingerprint: `fp-${i + 1}`,
        state: 'completed',
        response: { ok: true, order: i + 1 },
      }),
    ),
  );
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(seed);

    const [{ users, products, orders, order_items, idempotency_keys }] =
      await AppDataSource.query(
        `SELECT
           (SELECT count(*) FROM users)            AS users,
           (SELECT count(*) FROM products)         AS products,
           (SELECT count(*) FROM orders)           AS orders,
           (SELECT count(*) FROM order_items)      AS order_items,
           (SELECT count(*) FROM idempotency_keys) AS idempotency_keys`,
      );

    console.log('Seed complete (idempotent). Row counts:');
    console.table({ users, products, orders, order_items, idempotency_keys });
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
