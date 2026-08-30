INSERT INTO products (id, title, price_cents, currency, sku, description, created_at) VALUES
  (1, 'Mechanical Keyboard',           260000, 'USD', 'KB-001', 'Mechanical keyboard with Brown switches', '2026-08-20T10:00:00Z'),
  (2, 'Wireless Mouse',                125000, 'USD', 'MO-002', 'Ergonomic wireless mouse',                '2026-08-20T10:01:00Z'),
  (3, 'Mouse Pad',                      15000, 'USD', 'MP-003', 'Large desk mouse pad',                    '2026-08-20T10:02:00Z'),
  (4, 'USB-C Hub',                      89000, 'USD', 'HU-004', '7-in-1 USB-C hub',                        '2026-08-20T10:03:00Z'),
  (5, 'Webcam 1080p',                  200000, 'USD', 'WC-005', 'Full HD webcam',                          '2026-08-20T10:04:00Z'),
  (6, 'Desk Lamp',                      45000, 'USD', 'DL-006', 'LED desk lamp',                           '2026-08-20T10:05:00Z'),
  (7, 'Laptop Stand',                   78000, 'USD', 'LS-007', 'Aluminium laptop stand',                  '2026-08-20T10:06:00Z'),
  (8, 'Noise-Cancelling Headphones',   540000, 'USD', 'HP-008', 'Over-ear ANC headphones',                 '2026-08-20T10:07:00Z')
ON CONFLICT (id) DO NOTHING;

SELECT setval('products_id_seq', GREATEST((SELECT MAX(id) FROM products), 1));
