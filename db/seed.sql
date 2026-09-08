TRUNCATE order_items, orders, products, users RESTART IDENTITY CASCADE;

INSERT INTO users (email, full_name)
SELECT 'user' || g || '@example.com', 'User ' || g
FROM generate_series(1, 2000) AS g;

INSERT INTO products (title, price_cents, currency, sku, description)
SELECT
  'Product ' || g,
  (random() * 500000)::bigint,
  'USD',
  'SKU-' || lpad(g::text, 6, '0'),
  'Description for product ' || g
FROM generate_series(1, 30000) AS g;

INSERT INTO orders (user_id, currency, total_cents, status, created_at)
SELECT
  1 + (random() * 1999)::int,
  'USD',
  (random() * 1000000)::bigint,
  CASE
    WHEN s.r < 0.80 THEN 'new'
    WHEN s.r < 0.95 THEN 'paid'
    ELSE 'shipped'
  END,
  now() - (random() * interval '365 days')
FROM (SELECT random() AS r FROM generate_series(1, 150000)) AS s;

INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, line_total_cents)
SELECT
  o.id,
  1 + (random() * 29999)::int,
  1 + (random() * 4)::int,
  (random() * 500000)::bigint,
  (random() * 1000000)::bigint
FROM orders AS o, generate_series(1, 2) AS n;

VACUUM (ANALYZE);