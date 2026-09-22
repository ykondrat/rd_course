import 'reflect-metadata';

import { AppDataSource } from './data-source';
import { OrderItem } from './entities';

interface RevenueRow {
  product_id: string;
  title: string;
  sku: string;
  line_count: string;
  units_sold: string;
  revenue_cents: string;
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const rows = await AppDataSource.getRepository(OrderItem)
      .createQueryBuilder('oi')
      .innerJoin('oi.product', 'p')
      .select('p.id', 'product_id')
      .addSelect('p.title', 'title')
      .addSelect('p.sku', 'sku')
      .addSelect('COUNT(oi.id)', 'line_count')
      .addSelect('SUM(oi.quantity)', 'units_sold')
      .addSelect('SUM(oi.line_total_cents)', 'revenue_cents')
      .groupBy('p.id')
      .addGroupBy('p.title')
      .addGroupBy('p.sku')
      .orderBy('"revenue_cents"', 'DESC')
      .limit(10)
      .getRawMany<RevenueRow>();

    console.log('Top products by revenue (JOIN + GROUP BY via QueryBuilder):\n');
    console.table(
      rows.map((r) => ({
        product: r.title,
        sku: r.sku,
        order_lines: Number(r.line_count),
        units_sold: Number(r.units_sold),
        revenue_usd: (Number(r.revenue_cents) / 100).toFixed(2),
      })),
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
