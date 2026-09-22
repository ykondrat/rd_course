import 'reflect-metadata';

import {
  AbstractLogger,
  DataSource,
  LogLevel,
  LogMessage,
} from 'typeorm';

import { dataSourceOptions } from './data-source';
import { Order, OrderItem, Product } from './entities';

class QueryCountLogger extends AbstractLogger {
  count = 0;

  reset(): void {
    this.count = 0;
  }

  protected writeLog(
    _level: LogLevel,
    messages: LogMessage | LogMessage[],
  ): void {
    for (const m of Array.isArray(messages) ? messages : [messages]) {
      if (m.type === 'query') this.count += 1;
    }
  }
}

const logger = new QueryCountLogger(['query']);

const ds = new DataSource({
  ...dataSourceOptions,
  logging: ['query'],
  logger,
});

async function measure(label: string, fn: () => Promise<unknown>): Promise<number> {
  logger.reset();

  await fn();

  console.log(`  ${label}: ${logger.count} SQL queries`);

  return logger.count;
}

async function main(): Promise<void> {
  await ds.initialize();

  try {
    const orderRepo = ds.getRepository(Order);
    const itemRepo = ds.getRepository(OrderItem);
    const productRepo = ds.getRepository(Product);

    const n = await orderRepo.count();

    console.log(`Graph under test: order → items → product. Orders in DB (N): ${n}\n`);

    console.log('── BEFORE — naive (query inside a loop) ─────────────────────');
    const before = await measure('naive', async () => {
      const orders = await orderRepo.find();

      for (const order of orders) {
        const items = await itemRepo.find({
          where: { order: { id: order.id } },
          loadRelationIds: true,
        });

        for (const item of items) {
          await productRepo.findOneBy({ id: item.product as unknown as string });
        }
      }
    });

    console.log('\n── AFTER #1 — relations (single LEFT JOIN) ──────────────────');

    const afterJoin = await measure('relations / leftJoinAndSelect', () =>
      orderRepo.find({ relations: { items: { product: true } } }),
    );

    const afterJoinQb = await measure('leftJoinAndSelect (QueryBuilder)', () =>
      orderRepo
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.items', 'item')
        .leftJoinAndSelect('item.product', 'product')
        .getMany(),
    );

    console.log('\n── AFTER #2 — relationLoadStrategy: "query" (1 + 2×levels) ───');

    const afterQuery = await measure('relationLoadStrategy: query (2 levels)', () =>
      orderRepo.find({
        relations: { items: { product: true } },
        relationLoadStrategy: 'query',
      }),
    );

    console.log('\n── Independence from N — JOIN fix at two collection sizes ────');

    const half = Math.max(1, Math.floor(n / 2));
    const joinAll = () =>
      orderRepo
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.items', 'item')
        .leftJoinAndSelect('item.product', 'product');
    const full = await measure(`leftJoinAndSelect over all ${n} orders`, () =>
      joinAll().getMany(),
    );
    const halfCount = await measure(`leftJoinAndSelect over ~half (id <= ${half})`, () =>
      joinAll().where('o.id <= :half', { half }).getMany(),
    );

    console.log('\n──────────────────────── Summary ───────────────────────────');
    console.table([
      { strategy: 'naive (query in a loop)', queries: before, note: `≥ N (=${n})` },
      { strategy: 'relations / leftJoinAndSelect', queries: afterJoin, note: '1' },
      { strategy: 'leftJoinAndSelect (QueryBuilder)', queries: afterJoinQb, note: '1' },
      { strategy: "relationLoadStrategy: 'query' (2 levels)", queries: afterQuery, note: '1 + 2×2 = 5' },
    ]);
    console.log(
      `Constant regardless of N: JOIN fix = ${full} over all ${n} orders and ` +
        `${halfCount} over ~half — the number does not grow with the collection.`,
    );
    console.log(
      `Verdict: ${before} → ${afterJoin} (JOIN) / ${afterQuery} (query strategy). ` +
        'The "before" scales with N; the "after" is a small constant.',
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});