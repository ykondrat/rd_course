import { checkout } from './checkout';
import { log, note, pool, section } from './lib/db';

const BUYERS = 50;
const INITIAL_STOCK = 10;
const HUGE_BALANCE_CENTS = 1_000_000_00;

async function main(): Promise<number> {
  section('demo:race — concurrent checkouts without oversell');

  const product = await pool.query<{ id: string }>(
    `INSERT INTO products (title, price_cents, currency, sku, stock)
     VALUES ('Race Demo Product', 1000, 'USD', $1, $2)
     RETURNING id`,
    [`RACE-${Date.now()}`, INITIAL_STOCK],
  );
  const productId = product.rows[0].id;

  await pool.query(
    `INSERT INTO users (email, full_name, balance_cents)
     SELECT 'race-buyer-' || n || '@example.com', 'Race Buyer ' || n, $1
     FROM generate_series(0, $2) AS n
     ON CONFLICT (email) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`,
    [HUGE_BALANCE_CENTS, BUYERS - 1],
  );

  const buyers = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email LIKE 'race-buyer-%' ORDER BY id LIMIT $1`,
    [BUYERS],
  );

  const results = await Promise.all(
    buyers.rows.map((buyer) => checkout({ userId: buyer.id, productId, quantity: 1 })),
  );
  const successes = results.filter((result) => result.ok).length;

  const productAfter = await pool.query<{ stock: number }>(
    `SELECT stock FROM products WHERE id = $1`,
    [productId],
  );
  const finalStock = Number(productAfter.rows[0].stock);
  const negativeRows = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM products WHERE stock < 0`,
  );
  const negativeStockRows = Number(negativeRows.rows[0].count);

  note(`attempts: ${results.length}`);
  note(`successes: ${successes} (expected ${INITIAL_STOCK})`);
  note(`final stock: ${finalStock} (expected 0)`);
  note(`rows with negative stock: ${negativeStockRows} (expected 0)`);

  const invariantHolds =
    successes === INITIAL_STOCK && finalStock === 0 && negativeStockRows === 0;
  log(
    invariantHolds ? 'OK' : 'FAIL',
    invariantHolds
      ? `exactly ${INITIAL_STOCK} checkouts succeeded, stock hit 0, no oversell`
      : 'oversell / invariant violation',
  );
  return invariantHolds ? 0 : 1;
}

main()
  .then(async (exitCode) => {
    await pool.end();
    process.exit(exitCode);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });