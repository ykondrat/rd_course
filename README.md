# Marketplace API — (Variant B)

Spec-first Marketplace API (products + orders) with cursor pagination, idempotent order creation, and RFC 9457 `problem+json` errors.

**Chosen variant: Variant B — runtime validation on the boundary.**
`openapi/openapi.yaml` is the single source of truth; the running app validates every request and response against it with express-openapi-validator, and one global exception filter maps validator + domain errors to `application/problem+json`. Anything that contradicts the spec is rejected at the boundary.

## Run

### A) Docker (recommended — one command)

```bash
docker compose up --build
# API on http://localhost:3000
```

### B) Local (Node + a reachable Postgres)

```bash
npm install
docker compose up -d postgres      # or any Postgres 17 on localhost:5432 (override exposes it)
npm run build
npm run db:setup                   # applies db/01-schema.sql + db/02-seed.sql
npm start                          # http://localhost:3000
```

Configuration (env vars; defaults in `.env.example`): `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD`
`PGDATABASE` `PG_POOL_MAX` `PORT` `OPENAPI_SPEC`.

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
