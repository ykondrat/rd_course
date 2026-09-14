CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at);

CREATE INDEX IF NOT EXISTS orders_shipped_recent_idx ON orders (created_at DESC) WHERE status = 'shipped';

CREATE INDEX IF NOT EXISTS products_sku_lower_idx ON products (lower(sku));