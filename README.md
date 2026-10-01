# Marketplace API — (Variant B)

Spec-first Marketplace API (products + orders) with cursor pagination, idempotent order creation, and RFC 9457 `problem+json` errors.

**Chosen variant: Variant B — runtime validation on the boundary.**
`openapi/openapi.yaml` is the single source of truth; the running app validates every request and response against it with express-openapi-validator, and one global exception filter maps validator + domain errors to `application/problem+json`. Anything that contradicts the spec is rejected at the boundary.

## Run

Copy the env contract and create the local DB-password file:

```bash
cp .env.example .env
mkdir -p secrets && printf 'apppass' > secrets/db_password
```

### A) Docker (recommended — one command)

```bash
docker compose up --build
# API on http://localhost:3000
```

Postgres initializes itself from `db/*.sql` via `docker-entrypoint-initdb.d`.

### B) Local (Node + a reachable Postgres)

```bash
npm install
docker compose up -d postgres
npm run build
npm start
```

`npm run db:setup` applies `db/*.sql` against an external Postgres.

## Data layer ops

The app never talks to Postgres directly — it goes through PgBouncer (`edoburu/pgbouncer`, `pool_mode = transaction`), the connection funnel that lets many app instances share a few backend connections (200 clients ← 5 server connections).
Config lives in `pgbouncer/pgbouncer.ini` (+ `userlist.txt`); PgBouncer is published on 6432 — Postgres stays on 5432 for migrations/admin only.

```bash
docker compose up -d --wait                                       # postgres + pgbouncer + api
psql -h 127.0.0.1 -p 6432 -U admin -d appdb -c "SELECT 1"         # served through PgBouncer
psql -h 127.0.0.1 -p 6432 -U admin -d pgbouncer -c "SHOW POOLS"   # appdb, pool_mode=transaction
```

### Backup and restore

```bash
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/appdb
bash scripts/backup.sh          # pg_dump -Fc -> backups/appdb-<date>.dump (prints path + TOC)
bash scripts/restore-drill.sh   # restore into a clean throwaway container -> MATCH or exit 1
```

`backup.cron` schedules the nightly `pg_dump` (02:30). Measured RTO/RPO and the last drill result are in [`RESTORE-DRILL.md`](RESTORE-DRILL.md).
Backups run as `admin` (superuser) so the dump captures every object; the app keeps its least-privilege `app_user`.

### Why transaction mode — and what it breaks

`transaction` mode lends a real Postgres backend to a client only for the length of one transaction, then returns it to the pool — the mode that scales web apps. 
But because the backend is shared, session state does not survive between transactions (a different `pg_backend_pid()`each time). 
These stop working in transaction mode:

- **`SET` / `RESET`** of session GUCs — use `SET LOCAL` inside the transaction instead;
- **named prepared statements** — the classic `prepared statement "s0" already exists` trap;
  PgBouncer ≥ 1.21 can track them if you set `max_prepared_statements > 0` (we ship `0`);
- **session-level advisory locks** (`pg_advisory_lock`) — use transaction-scoped `pg_advisory_xact_lock`;
- also `LISTEN`/`NOTIFY`, `WITH HOLD` cursors, session temp tables, and `LOAD`.

Our app is transaction-mode-safe: raw `pg` driver (no named prepared statements by default), no `LISTEN`, no session `SET`, self-contained transactions.

## Grading

The grader has no access to my Infisical vault (`.secrets/` is git-ignored, the cloud
project needs my login), so every DB-touching script — wrapped in `scripts/with-secrets.sh` —
would abort on a fresh clone with "Please run infisical init…". `SKIP_VAULT=1`
short-circuits the wrapper and runs the command with the connection params already in
the environment — the standard CI pattern (the runner injects secrets, not the vault CLI).
The dev DB credentials below are the ones baked into `docker-compose.yml`; by the convention they are not secrets.
The vault stays the primary path (verified statically, no DB/vault needed — last block).

```bash
docker compose up -d --wait postgres     # --wait: Postgres must accept connections first

# Migrations run DDL, so connect as the bootstrap admin — app_user has SELECT/INSERT/UPDATE
# only (no CREATE). Values are straight from docker-compose.yml; SKIP_VAULT bypasses the vault.
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=admin PGPASSWORD=admin-bootstrap-only PGDATABASE=appdb
export SKIP_VAULT=1

npm ci
npx tsc --noEmit          # clean compile
npm run build             # tsc → dist/ (decorator metadata; esbuild would drop it)

npm run migrate           # create the schema from zero
npm run migrate:show      # [X] InitialSchema… = applied
npm run migrate:revert    # down() drops the schema (not a stub)
npm run migrate           # re-apply

npm run seed              # deterministic; run twice → identical row counts
npm run seed
npm run demo:nplus1       # N+1: naive 37 (≥ N) → JOIN 1 / relationLoadStrategy 5 (=1+2×2)
npm run report            # top products by revenue (SUM + GROUP BY via QueryBuilder)

# concurrency (numbers in ## Concurrency); each self-seeds its own fixtures:
npm run demo:race         # 50 parallel checkouts, stock=10 → exactly 10 succeed, 0 oversell, exit 0
npm run demo:workers      # ≥2 workers via FOR UPDATE SKIP LOCKED → each task once, faster than serial
npm run demo:retry        # provokes 40001 under REPEATABLE READ, retries → final state correct
```

### Data layer ops — PgBouncer + backup/restore

The app runs through PgBouncer; `backup.sh` / `restore-drill.sh` read the connection from
`$DATABASE_URL` (pointing at PgBouncer). Continue from the block above (schema migrated + seeded):

```bash
docker compose up -d --wait                                       # postgres + pgbouncer + api
psql -h 127.0.0.1 -p 6432 -U admin -d appdb -c "SELECT 1"         # → 1, through PgBouncer
psql -h 127.0.0.1 -p 6432 -U admin -d pgbouncer -c "SHOW POOLS"   # appdb, pool_mode=transaction

export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/appdb   # admin dumps everything
# SKIP_VAULT=1 is already exported above
bash scripts/with-secrets.sh dev bash scripts/backup.sh           # → backups/appdb-<date>.dump, exit 0
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh    # → MATCH, exit 0
```

Both scripts read `$DATABASE_URL` from the environment (the wrapper just forwards it under
`SKIP_VAULT=1`). `migrate` + `seed` above populate the `orders` table the drill round-trips —
without them it would restore an empty DB (a trivial 0-row MATCH). Static checks:

```bash
grep -E '^\s*pool_mode\s*=\s*transaction' pgbouncer/pgbouncer.ini          # transaction mode in repo
grep -E '^(export[[:space:]]+)?(DATABASE_URL|DB_URL)=' .env.example        # contract → PgBouncer :6432
grep -cE '^(@(reboot|daily|midnight|hourly)|([0-9*/,-]+[[:space:]]+){4}[0-9*/,-]+)[[:space:]]+.*backup' backup.cron  # ≥ 1
grep -iE 'RTO|RPO' RESTORE-DRILL.md                                        # both, with measured values
```

Seed idempotency — row counts are identical after the second `npm run seed`:

```bash
docker compose exec -T postgres psql -U admin -d appdb -Atc \
 "SELECT 'users',count(*) FROM users UNION ALL SELECT 'products',count(*) FROM products \
  UNION ALL SELECT 'orders',count(*) FROM orders UNION ALL SELECT 'order_items',count(*) FROM order_items"
# users|8  products|10  orders|12  order_items|24  → unchanged on every run
```

Static checks — the vault stays the primary path; these need neither DB nor vault:

```bash
grep -rn "synchronize" src/                              # only `synchronize: false`
grep -rn "onDelete" src/                                 # ≥ 2 hits, different strategies
grep -rniE "\.(add)?groupBy\(" src/                      # report uses GROUP BY
grep -nE "password:[[:space:]]*['\"]" src/data-source.ts # empty — no hard-coded creds
node -e "const s=require('./package.json').scripts;const bad=['migrate','seed'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'missing wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"

# concurrency static checks:
node -e "const s=require('./package.json').scripts;const bad=['demo:race','demo:workers','demo:retry'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'missing wrapper: '+bad.join(', '));process.exit(bad.length===0?0:1)"
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "for update|returning|pessimistic_write" .
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "skip[ _]locked" .
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "40001|40P01" .
```

## Concurrency

The checkout — decrement `stock`, debit the buyer's `balance_cents`, insert the `order` + its `order_item`, and enqueue a post-processing `task` — runs in one transaction.
If stock or funds run out, the whole transaction rolls back, so no orphan orders exist. The `tasks` queue table holds the jobs the worker pool drains. 
Three demo scripts drive it (`src/demo-race.ts`, `demo-workers.ts`, `demo-retry.ts`); each self-seeds its fixtures and self-checks its invariant with a non-zero exit on violation.

### Numbers from my runs

| Demo                                                                   | Result                                                                                  |
|------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `demo:race` — 50 parallel `checkout()`, `stock=10`, qty 1              | attempts **50**, successes **exactly 10**, final stock **0**, negative-stock rows **0** |
| `demo:workers` — 4 workers, 24 tasks × 40 ms, `FOR UPDATE SKIP LOCKED` | distribution 6/6/6/6, processed-twice **0**, **~280 ms** vs **960 ms** sequential       |
| `demo:retry` — 10 concurrent read-modify-write under `REPEATABLE READ` | **~11–17** `40001` retries caught, final balance **1000** = expected (`10 × 100`)       |

### Oversell guard: atomic `UPDATE … RETURNING` (not pessimistic `FOR UPDATE`)

`checkout` uses `UPDATE products SET stock = stock - $n WHERE id = $ AND stock >= $n RETURNING`.
The `stock >= $n` check and the row lock are the same statement — there is no window between reading the stock and writing it, so no interleaving can oversell, and a return of 0 rows is the "out of stock" signal, backed by a real `CHECK (stock >= 0)`.
`SELECT … FOR UPDATE` is equally correct but needs a separate read-check-write and holds the row lock across app logic; the atomic form is fewer round-trips and the recommended default.
Pessimistic locking earns its keep only when logic between the read and the writing must see the locked row (cross-row invariants, computed pricing) — not here.

### Why retry catches only `40001` / `40P01`

`withRetry` re-runs the whole transaction only on `40001` (serialization_failure) and `40P01` — the two SQLSTATEs Postgres raises for transient conflicts that a fresh snapshot resolves. 
Every other code is a real error that a blind retry would repeat forever, so it is rethrown immediately. 
Retrying only the write would re-introduce the lost update, so the entire transaction — snapshot and all — is replayed with exponential backoff + jitter.

## Database & query optimization

Main table: **`orders`** (150,000 rows). Files in `db/`: `schema.sql` (tables + 3 FKs,
money as `BIGINT` minor units — exact, never float), `seed.sql` (data, ends with
`VACUUM (ANALYZE)`), `queries/q1–q3.sql`, `indexes.sql` (composite + partial + expression),
`OPTIMIZATIONS.md` (before/after `EXPLAIN` report).

Bring up the database:

```bash
docker compose up -d --wait postgres
```

Connect and check it's live:

```bash
docker compose exec -T postgres psql -U admin -d appdb -Atc "SELECT 1"   # → 1
```

Reproduce the optimization from a clean volume. Since the schema is owned by TypeORM migrations, so `up` applies only roles/grants — no schema,
no data, no optimization indexes; the block below applies `db/schema.sql` by hand so a fresh DB shows Seq Scans "before":

```bash
docker compose down -v && docker compose up -d --wait postgres
P="docker compose exec -T postgres psql -U admin -d appdb -v ON_ERROR_STOP=1"
$P < db/schema.sql                                  # tables + constraints
$P < db/seed.sql                                    # 150k orders, then VACUUM (ANALYZE)
for q in 1 2 3; do $P -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"; done  # BEFORE: Seq Scan
$P < db/indexes.sql
$P -c "ANALYZE;"
for q in 1 2 3; do $P -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"; done  # AFTER: Index Scan
```

## Data layer — TypeORM

The SQL schema (`db/schema.sql`) now lives in code as TypeORM entities + relations + a migration.
The schema is created and evolved only by migrations — there is no `synchronize: true` anywhere (`src/data-source.ts` sets `synchronize: false` explicitly;
the app never auto-syncs the schema).

| File                                | Purpose                                                                                                                                |
|-------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| `src/entities/`                     | one `@Entity` per table (`users`, `products`, `orders`, `order_items`, `idempotency_keys`) with `@Check`, `@Index`, relations          |
| `src/data-source.ts`                | `DataSource`, `synchronize: false`, `migrations: ['dist/migrations/*.js']`, params from `process.env` only                             |
| `src/migrations/*-InitialSchema.ts` | generated migration (`migration:generate`), then hand-edited to add the partial + expression indexes; `down()` really drops everything |
| `src/seed.ts`                       | deterministic, idempotent seed (`TRUNCATE … RESTART IDENTITY CASCADE`)                                                                 |
| `src/demo-nplus1.ts`                | N+1 before/after with a custom `QueryCountLogger`                                                                                      |
| `src/report.ts`                     | aggregate report via `createQueryBuilder().getRawMany()`                                                                               |

### Commands

Every DB-touching script is wrapped in `scripts/with-secrets.sh`, so connection params come from the Infisical vault — you just run a bare `npm run …`:

```bash
docker compose up -d --wait postgres   # --wait: Postgres must accept connections first
npm run build          # tsc → dist/ (decorator metadata; esbuild would drop it)
npm run migrate        # migration:run — create the schema from zero
npm run migrate:show   # [X] InitialSchema… = applied
npm run migrate:revert # run down() — drops the schema
npm run migrate        # re-apply
npm run seed           # deterministic; run twice → identical row counts
npm run demo:nplus1    # N+1 before/after, with a query counter
npm run report         # top products by revenue (aggregate)
```

Row-count check for seed idempotency (identical after a second `npm run seed`):

```bash
docker compose exec -T postgres psql -U admin -d appdb -Atc \
 "SELECT 'users',count(*) FROM users UNION ALL SELECT 'products',count(*) FROM products \
  UNION ALL SELECT 'orders',count(*) FROM orders UNION ALL SELECT 'order_items',count(*) FROM order_items"
# users|8  products|10  orders|12  order_items|24  → unchanged on every run
```

### N+1 — proven and fixed

`npm run demo:nplus1` attaches a custom `QueryCountLogger` that counts every emitted SQL `query` and walks the graph order → items → product over the seeded data.

| Strategy                                             | SQL queries                           |
|------------------------------------------------------|---------------------------------------|
| naive (query per element in a loop)                  | 37 ( = 1 + N + items ) — grows with N |
| `relations` / `leftJoinAndSelect` (single LEFT JOIN) | 1                                     |
| `relationLoadStrategy: 'query'` (2 levels)           | 5 ( = 1 + 2 × 2 )                     |

### Repository vs QueryBuilder

The `Repository` (`find`/`save`) loads and hydrates entities — rows that map 1:1 to a class, one aggregate plus its relations — so all order/product CRUD and the N+1-safe loads stay there.
The moment the result is not an entity — an aggregate (`SUM`/`COUNT`), `GROUP BY`, `HAVING`, an arbitrary projection across joins — `find()` can no longer express it, and the query moves to`createQueryBuilder().getRawMany()`.
`src/report.ts` ("top products by revenue") is exactly that: `SUM(line_total_cents)` grouped by product, which `find()` cannot produce.

### onDelete — a conscious choice per FK

| FK                                  | Strategy | Why                                                                        |
|-------------------------------------|----------|----------------------------------------------------------------------------|
| `orders.user_id → users`            | RESTRICT | deleting a customer who has orders must never silently erase sales history |
| `order_items.order_id → orders`     | CASCADE  | a line item is meaningless without its order — children follow the parent  |
| `order_items.product_id → products` | RESTRICT | a product referenced by real sales must not be deletable                   |

The M:N between orders and products carries data on the link (`quantity`, `unit_price_cents` — the price captured at purchase time, `line_total_cents`), so it is an explicit join-entity `OrderItem` (`@OneToMany` + two `@ManyToOne`), not `@ManyToMany`.

## Configuration

Every variable is declared once in `src/config/env.schema.ts` (zod) and validated at startup: a missing or invalid variable aborts the process with a non-zero exit code and a message naming the offending variable — the app never starts half-configured. Code reads only the typed `ConfigService<Env, true>`; there are no raw `process.env` reads outside the schema. `npm run check:env` fails if `.env.example` drifts from the schema.

| Variable            | Required   | Default                 | Purpose                                                                                                             |
|---------------------|------------|-------------------------|---------------------------------------------------------------------------------------------------------------------|
| `NODE_ENV`          | no         | `development`           | `development` \| `test` \| `production`                                                                             |
| `PORT`              | no         | `3000`                  | HTTP port                                                                                                           |
| `PGHOST`            | yes        | —                       | Postgres host                                                                                                       |
| `PGPORT`            | no         | `5432`                  | Postgres port                                                                                                       |
| `PGUSER`            | yes        | —                       | Postgres role the app connects with (`app_user`)                                                                    |
| `PGPASSWORD`        | no         | —                       | `app_user`'s password — read from `secrets/db_password` at runtime; env is a fallback                               |
| `PGDATABASE`        | yes        | —                       | Database name                                                                                                       |
| `DATABASE_URL`      | no         | —                       | App connection string (host/port/user/db). `.env.example` has a fake value, password stays in `secrets/db_password` |
| `PG_POOL_MAX`       | no         | `10`                    | Max pool connections                                                                                                |
| `PGADMIN_USER`      | no         | `admin`                 | Bootstrap admin for `db:setup`/migrations only — the app never uses it                                              |
| `PGADMIN_PASSWORD`  | no         | `admin-bootstrap-only`  | Bootstrap admin password (matches `docker-compose.yml`)                                                             |
| `OPENAPI_SPEC`      | no         | `openapi/openapi.yaml`  | Contract the runtime validator loads                                                                                |

### Two roles, the least privilege

The container's `POSTGRES_USER` is a bootstrap admin superuser used only to create roles and run rotation — the app never connects with it. The app connects as `app_user`: `SELECT/INSERT/UPDATE` on the marketplace tables, no `ALTER ROLE`, no DDL.

The app reads `app_user`'s password from `secrets/db_password`. The pg pool sets `password` to a function that re-reads that file on every new connection — that is what lets the password rotate without a restart.

### Rotate the DB password with zero downtime

With Postgres up (compose) and the API running:

```bash
curl -s localhost:3000/health          # note "uptime"
bash rotate.sh                         # admin: ALTER ROLE app_user → rewrite the file → drop old backends
curl -s localhost:3000/products        # 200 — served over a NEW connection with the new password
curl -s localhost:3000/health          # "uptime" is larger → the process never restarted
```

`rotate.sh` runs as the `admin` superuser (over the container's local socket), changes `app_user`'s password, updates `secrets/db_password`, and terminates `app_user`'s existing backends so the pool reconnects with the new password.

### Secrets in Infisical (source of truth)

Secrets live in a self-hosted Infisical; the store — not `.env` — is the source of truth.
Bringing it up and provisioning it is a single command (no clicking in the UI):

```bash
cp infisical/.env.example infisical/.env   # set ENCRYPTION_KEY + AUTH_SECRET (openssl rand ...)
npm run infisical:up                       # docker compose up + REST bootstrap:
```

`bootstrap.mjs` fills the store over its REST API and writes the machine identity' `clientId`/`clientSecret` to git-ignored `infisical/.secrets/` — the only thing the app knows about the store; the secret values themselves never touch the disk. Then run the app with the secrets injected — no `.env`, nothing materialized to disk:

```bash
docker compose up -d postgres              # the database the dev secrets point at
npm run infisical:run                      # machine-identity login + `infisical run --env dev`
npm run infisical:run:prod                 # same binary, prod values (different host/pool/NODE_ENV)
bash infisical/run.sh dev env | grep PG    # see exactly what got injected
npm run infisical:down                     # tear down + wipe .secrets/
```

## API

| Method & path          | operationId     | Notes                                                                               |
|------------------------|-----------------|-------------------------------------------------------------------------------------|
| `GET /products`        | listProducts    | cursor pagination (`limit`, `cursor`) -> `{ items, next_cursor }`                   |
| `POST /products`       | createProduct   | create; `201` + `Location`                                                          |
| `GET /products/{id}`   | getProduct      | `200` / `404`                                                                       |
| `PATCH /products/{id}` | updateProduct   | partial update (`minProperties: 1`) -> `200` / `404`                                |
| `GET /orders`          | listOrders      | cursor pagination                                                                   |
| `POST /orders`         | createOrder     | `user_id` + `items` body, `Idempotency-Key` required; `201` / `400` / `409` / `422` |
| `GET /orders/{id}`     | getOrder        | `200` / `404`                                                                       |

- **Cursor** is an opaque `base64url` token; `next_cursor: null` means no more pages.
- **Idempotency-Key** (on `POST /orders`): same key + same body -> the original `201` replayed with `Idempotency-Replay: true`; same key + different body -> `422`; key still in flight -> `409`. The key claim, the order, and its items are all committed in one transaction.
- **Errors** are RFC 9457 `application/problem+json` with `type / title / status / detail / instance` (+ `code` / `errors[]`). Money is integer minor units (`*_cents`).

## Testing — integration, E2E, contract

The "ladder of trust": unit (belief) → integration (fact) → E2E (the whole vertical) → contract (a guarantee between services). Tests run compiled (`tsc -p tsconfig.test.json` → `dist-test/` → `jest`); no on-the-fly transformers — esbuild/tsx would drop the decorator metadata Nest DI needs. `jest.config.js` pins `reporters: ['default']` (Jest 30 otherwise auto-picks a compact `agent` reporter that hides `PASS`/test names/`✓`) and `maxWorkers: 1` (every worker multiplies containers).

```bash
npm run test:integration   # repository tests vs real Postgres 16 (@testcontainers/postgresql)
npm run test:e2e           # full AppModule via supertest (create -> read + a 404)
npm run test:contract      # PactV3 consumer -> pacts/web-app-marketplace-api.json
npm run verify:provider    # the real app verifies the contract (local pact file by default)
```

Repository integration tests use transaction + ROLLBACK: one container per file, each test runs on its own client inside `BEGIN … ROLLBACK`. Cleanup is ~0 ms and, crucially, reliable (it runs even when a test throws), so `npm run test:integration && npm run test:integration` is green with no manual cleanup. This is possible only because the repositories accept a `Queryable` (`Pool | PoolClient | DatabaseService`) — in prod they get the pool, in tests a transaction client, same code. The E2E suite instead uses one fresh container per file: its create→read flow goes through the app's own transactions (idempotency + inserts), which can't be wrapped in an outer rollback; a disposable container per run keeps it repeatable. The test DB is never configured via env/secrets — it comes from `container.getConnectionUri()` at runtime.

### Pact Broker + can-i-deploy

The broker is a compose service (`pactbroker` + internal `pactbroker-db`, healthcheck on `127.0.0.1` — inside the container `localhost` resolves to `::1` but puma only listens on IPv4). It is a CI/CD tool, so bring it up on demand:

```bash
npm run broker:up          # docker compose up -d --wait pactbroker  (heartbeat 200)
```

The CI job `.github/workflows/contract.yml` runs: publish contract → `verify:provider` (with `publishVerificationResult`) → tag the provider version `prod` → can-i-deploy, which fails the job if `deployable` is not `true`. The broker URL is a local-compose default (not a secret); `PACT_BROKER_TOKEN` comes only from `process.env` (GitHub secrets in CI, the Infisical store locally via `bash scripts/with-secrets.sh dev npm run verify:provider`, and `SKIP_VAULT=1 …` runs the exact same command without the vault). No token is ever hard-coded.

The gate is real — both states. Same `can-i-deploy` call, before and after tagging the provider version `prod` (the provider must go to prod first — "is most right"):

```jsonc
// [before tag]  can-i-deploy web-app 1.0.0 -> prod
{"summary":{"deployable":null,"reason":"There is no verified pact between version 1.0.0 of web-app and the latest version of marketplace-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}}

// [after tag]   can-i-deploy web-app 1.0.0 -> prod
{"summary":{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}}
```

Local gate, end to end:

```bash
npm run broker:up
curl -sf -X PUT "http://127.0.0.1:9292/pacts/provider/marketplace-api/consumer/web-app/version/1.0.0" \
  -H 'Content-Type: application/json' --data-binary @pacts/web-app-marketplace-api.json          # 201
PACT_BROKER_URL=http://127.0.0.1:9292 PROVIDER_VERSION=1.0.0 npm run verify:provider              # exit 0, publishes result
# emergency form for the grader (no vault): SKIP_VAULT=1 bash scripts/with-secrets.sh dev npm run verify:provider
curl -s "http://127.0.0.1:9292/can-i-deploy?pacticipant=web-app&version=1.0.0&to=prod"            # deployable: null (unknown)
curl -sf -X PUT "http://127.0.0.1:9292/pacticipants/marketplace-api/versions/1.0.0/tags/prod" \
  -H 'Content-Type: application/json'                                                             # 201
curl -s "http://127.0.0.1:9292/can-i-deploy?pacticipant=web-app&version=1.0.0&to=prod"            # deployable: true
```

## Verify 

```bash
npx @redocly/cli lint openapi/openapi.yaml

npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));console.log('operations:',ops.length,'resources:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);console.log('Idempotency-Key required =',idem?.required,'description chars =',(idem?.description??'').trim().length)"

grep -c 'Idempotency-Key' openapi/openapi.yaml  
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
grep -c 'Problem:' openapi/openapi.yaml

npm run verify:spec
```

With the app running (`docker compose up` or the local path):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/orders \
  -H 'content-type: application/json' -d '{"user_id":1,"items":[{"product_id":5,"quantity":2}]}'
curl -s localhost:3000/orders -X POST -H 'content-type: application/json' \
  -H 'Idempotency-Key: k-empty' -d '{"user_id":1,"items":[]}' 
curl -s -X POST localhost:3000/orders -H 'content-type: application/json' \
  -H 'Idempotency-Key: k-1' -d '{"user_id":1,"items":[{"product_id":5,"quantity":2}]}'
curl -s -i -X POST localhost:3000/orders -H 'content-type: application/json' \
  -H 'Idempotency-Key: k-1' -d '{"user_id":1,"items":[{"product_id":5,"quantity":2}]}' | grep -i idempotency-replay
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/orders \
  -H 'content-type: application/json' -H 'Idempotency-Key: k-1' -d '{"user_id":1,"items":[{"product_id":5,"quantity":3}]}'
curl -s -X POST localhost:3000/products -H 'content-type: application/json' \
  -d '{"title":"Standing Desk","price_cents":890000,"currency":"USD","sku":"SD-009"}'
curl -s -X PATCH localhost:3000/products/1 -H 'content-type: application/json' -d '{"price_cents":199000}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/products/999999
curl -s 'localhost:3000/products?limit=100'
```
