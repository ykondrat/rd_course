CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  title        TEXT        NOT NULL,
  price_cents  BIGINT      NOT NULL CHECK (price_cents >= 0),
  currency     TEXT        NOT NULL,
  sku          TEXT        NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_page_idx ON products (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  currency     TEXT        NOT NULL,
  total_cents  BIGINT      NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'new',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_page_idx ON orders (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  quantity          INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price_cents  BIGINT  NOT NULL,
  line_total_cents  BIGINT  NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT PRIMARY KEY,
  fingerprint TEXT        NOT NULL,
  state       TEXT        NOT NULL,
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
