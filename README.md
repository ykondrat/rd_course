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

## Configuration

Every variable is declared once in `src/config/env.schema.ts` (zod) and validated at startup: a missing or invalid variable aborts the process with a non-zero exit code and a message naming the offending variable — the app never starts half-configured. Code reads only the typed `ConfigService<Env, true>`; there are no raw `process.env` reads outside the schema. `npm run check:env` fails if `.env.example` drifts from the schema.

| Variable           | Required  | Default                | Purpose                                                                               |
|--------------------|-----------|------------------------|---------------------------------------------------------------------------------------|
| `NODE_ENV`         | no        | `development`          | `development` \| `test` \| `production`                                               |
| `PORT`             | no        | `3000`                 | HTTP port                                                                             |
| `PGHOST`           | yes       | —                      | Postgres host                                                                         |
| `PGPORT`           | no        | `5432`                 | Postgres port                                                                         |
| `PGUSER`           | yes       | —                      | Postgres role the app connects with (`app_user`)                                      |
| `PGPASSWORD`       | no        | —                      | `app_user`'s password — read from `secrets/db_password` at runtime; env is a fallback |
| `PGDATABASE`       | yes       | —                      | Database name                                                                         |
| `PG_POOL_MAX`      | no        | `10`                   | Max pool connections                                                                  |
| `PGADMIN_USER`     | no        | `admin`                | Bootstrap admin for `db:setup`/migrations only — the app never uses it                |
| `PGADMIN_PASSWORD` | no        | `admin-bootstrap-only` | Bootstrap admin password (matches `docker-compose.yml`)                               |
| `OPENAPI_SPEC`     | no        | `openapi/openapi.yaml` | Contract the runtime validator loads                                                  |

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

| Method & path          | operationId     | Notes                                                             |
|------------------------|-----------------|-------------------------------------------------------------------|
| `GET /products`        | listProducts    | cursor pagination (`limit`, `cursor`) -> `{ items, next_cursor }` |
| `POST /products`       | createProduct   | create; `201` + `Location`                                        |
| `GET /products/{id}`   | getProduct      | `200` / `404`                                                     |
| `PATCH /products/{id}` | updateProduct   | partial update (`minProperties: 1`) -> `200` / `404`              |
| `GET /orders`          | listOrders      | cursor pagination                                                 |
| `POST /orders`         | createOrder     | `Idempotency-Key` required; `201` / `400` / `409` / `422`         |
| `GET /orders/{id}`     | getOrder        | `200` / `404`                                                     |

- **Cursor** is an opaque `base64url` token; `next_cursor: null` means no more pages.
- **Idempotency-Key** (on `POST /orders`): same key + same body -> the original `201` replayed with `Idempotency-Replay: true`; same key + different body -> `422`; key still in flight -> `409`. The key claim, the order, and its items are all committed in one transaction.
- **Errors** are RFC 9457 `application/problem+json` with `type / title / status / detail / instance` (+ `code` / `errors[]`). Money is integer minor units (`*_cents`).

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
  -H 'content-type: application/json' -d '{"items":[{"product_id":5,"quantity":2}]}'
curl -s localhost:3000/orders -X POST -H 'content-type: application/json' \
  -H 'Idempotency-Key: k-empty' -d '{"items":[]}' 
curl -s -X POST localhost:3000/orders -H 'content-type: application/json' \
  -H 'Idempotency-Key: k-1' -d '{"items":[{"product_id":5,"quantity":2}]}'
curl -s -i -X POST localhost:3000/orders -H 'content-type: application/json' \
  -H 'Idempotency-Key: k-1' -d '{"items":[{"product_id":5,"quantity":2}]}' | grep -i idempotency-replay
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/orders \
  -H 'content-type: application/json' -H 'Idempotency-Key: k-1' -d '{"items":[{"product_id":5,"quantity":3}]}'
curl -s -X POST localhost:3000/products -H 'content-type: application/json' \
  -d '{"title":"Standing Desk","price_cents":890000,"currency":"USD","sku":"SD-009"}'
curl -s -X PATCH localhost:3000/products/1 -H 'content-type: application/json' -d '{"price_cents":199000}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/products/999999
curl -s 'localhost:3000/products?limit=100'
```
