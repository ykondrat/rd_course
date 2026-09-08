# Query optimization report

`EXPLAIN (ANALYZE, BUFFERS)` for each of the three API queries, before any optimization index and after `db/indexes.sql` + `ANALYZE`.
Run on `postgres:17`, 150,000 orders / 30,000 products / 2,000 users.
Numbers are from this machine and will differ on yours — what matters is the plan node that disappears and the drop in buffers, not the milliseconds. Money is stored as`BIGINT` integer minor units (`*_cents`) — exact, never `float`.

| Query                          | Before                     | After                       | Speed-up  |
|--------------------------------|----------------------------|-----------------------------|-----------|
| q1 — orders by owner + period  | Parallel Seq Scan, 3.80 ms | Bitmap Index Scan, 0.079 ms | ~48×      |
| q2 — recent shipped orders     | Seq Scan + Sort, 5.74 ms   | Index Scan, 0.170 ms        | ~34×      |
| q3 — case-insensitive SKU      | Seq Scan, 4.03 ms          | Index Scan, 0.037 ms        | ~109×     |

---

## q1 — orders by owner + period

```sql
SELECT * FROM orders WHERE user_id = 42 AND created_at >= now() - interval '90 days';
```

Index: `CREATE INDEX orders_user_created_idx ON orders (user_id, created_at);`

**Before**
```
 Gather  (cost=1000.00..4016.51 rows=18 width=32) (actual time=0.095..3.789 rows=11 loops=1)
   Workers Planned: 1
   Workers Launched: 1
   Buffers: shared hit=1250
   ->  Parallel Seq Scan on orders  (cost=0.00..3014.71 rows=11 width=32) (actual time=0.035..2.475 rows=6 loops=2)
         Filter: ((user_id = 42) AND (created_at >= (now() - '90 days'::interval)))
         Rows Removed by Filter: 74994
         Buffers: shared hit=1250
 Planning Time: 0.163 ms
 Execution Time: 3.800 ms
```

**After**
```
 Bitmap Heap Scan on orders  (cost=4.61..70.49 rows=18 width=32) (actual time=0.023..0.057 rows=11 loops=1)
   Recheck Cond: ((user_id = 42) AND (created_at >= (now() - '90 days'::interval)))
   Heap Blocks: exact=11
   Buffers: shared hit=11 read=4
   ->  Bitmap Index Scan on orders_user_created_idx  (cost=0.00..4.60 rows=18 width=0) (actual time=0.019..0.019 rows=11 loops=1)
         Index Cond: ((user_id = 42) AND (created_at >= (now() - '90 days'::interval)))
         Buffers: shared read=4
 Planning Time: 0.245 ms
 Execution Time: 0.079 ms
```

The Parallel Seq Scan that read all 150k rows and threw away 74,994 (`Buffers: shared hit=1250`) is replaced by a Bitmap Index Scan on `(user_id, created_at)` that touches only the 11 matching rows (`Buffers: 15`).

---

## q2 — recent shipped orders

```sql
SELECT id, user_id, total_cents, created_at FROM orders WHERE status = 'shipped' ORDER BY created_at DESC LIMIT 50;
```

Index: `CREATE INDEX orders_shipped_recent_idx ON orders (created_at DESC) WHERE status = 'shipped';` (partial)

**Before**
```
 Limit  (cost=3363.51..3363.64 rows=50 width=24) (actual time=5.724..5.728 rows=50 loops=1)
   Buffers: shared hit=1253
   ->  Sort  (cost=3363.51..3381.46 rows=7180 width=24) (actual time=5.723..5.724 rows=50 loops=1)
         Sort Key: created_at DESC
         Sort Method: top-N heapsort  Memory: 30kB
         Buffers: shared hit=1253
         ->  Seq Scan on orders  (cost=0.00..3125.00 rows=7180 width=24) (actual time=0.004..5.292 rows=7399 loops=1)
               Filter: (status = 'shipped'::text)
               Rows Removed by Filter: 142601
               Buffers: shared hit=1250
 Planning Time: 0.157 ms
 Execution Time: 5.738 ms
```

**After**
```
 Limit  (cost=0.28..35.91 rows=50 width=24) (actual time=0.028..0.153 rows=50 loops=1)
   Buffers: shared hit=50 read=2
   ->  Index Scan using orders_shipped_recent_idx on orders  (cost=0.28..5201.76 rows=7300 width=24) (actual time=0.028..0.149 rows=50 loops=1)
         Buffers: shared hit=50 read=2
 Planning Time: 0.243 ms
 Execution Time: 0.170 ms
```

The Seq Scan + top-N Sort over all 150k rows (`Buffers: 1253`) collapses to an Index Scan on the partial index: because it only contains the ~5% `shipped` rows already ordered by `created_at DESC`, the Sort node disappears and only 50 rows are read (`Buffers: 52`).

---

## q3 — case-insensitive SKU lookup

```sql
SELECT * FROM products WHERE lower(sku) = lower('SKU-012345');
```

Index: `CREATE INDEX products_sku_lower_idx ON products (lower(sku));` (expression)

**Before**
```
 Seq Scan on products  (cost=0.00..878.00 rows=150 width=77) (actual time=1.679..4.024 rows=1 loops=1)
   Filter: (lower(sku) = 'sku-012345'::text)
   Rows Removed by Filter: 29999
   Buffers: shared hit=428
 Planning Time: 0.153 ms
 Execution Time: 4.034 ms
```

**After**
```
 Index Scan using products_sku_lower_idx on products  (cost=0.29..8.30 rows=1 width=77) (actual time=0.018..0.018 rows=1 loops=1)
   Index Cond: (lower(sku) = 'sku-012345'::text)
   Buffers: shared hit=1 read=2
 Planning Time: 0.261 ms
 Execution Time: 0.037 ms
```

A plain index on `sku` can't answer `lower(sku) = …`, so the Seq Scan read all 30k products (`Buffers: 428`); the expression index on `lower(sku)` turns it into a single-row Index Scan (`Buffers: 3`).

---
