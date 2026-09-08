DROP TABLE IF EXISTS order_items, orders, products, users, idempotency_keys CASCADE;

CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text        NOT NULL UNIQUE,
  full_name  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       text        NOT NULL,
  price_cents bigint      NOT NULL CHECK (price_cents >= 0),
  currency    text        NOT NULL,
  sku         text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint      REFERENCES users(id),
  currency    text        NOT NULL,
  total_cents bigint      NOT NULL CHECK (total_cents >= 0),
  status      text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'paid', 'shipped')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       bigint  NOT NULL REFERENCES products(id),
  quantity         integer NOT NULL CHECK (quantity >= 1),
  unit_price_cents bigint  NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents bigint  NOT NULL CHECK (line_total_cents >= 0)
);

CREATE TABLE idempotency_keys (
  key         text PRIMARY KEY,
  fingerprint text        NOT NULL,
  state       text        NOT NULL,
  response    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
