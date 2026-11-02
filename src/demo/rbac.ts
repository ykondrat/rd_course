import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { authedFetch, bootApp, forgeAdmin, login, seedWorld } from './helpers/auth-harness';
import { hdr, kv, note } from './helpers/output';

async function main(): Promise<number> {
  const { app, baseUrl, db } = await bootApp();

  try {
    const world = await seedWorld(db);
    const orderUrl = `${baseUrl}/orders/${world.orderId}`;
    const productBody = { title: 'Demo', price_cents: 1000, currency: 'USD', sku: `DEMO-${randomUUID()}` };

    const buyer = await login(baseUrl, world.buyer.email);
    const buyer2 = await login(baseUrl, world.buyer2.email);
    const seller = await login(baseUrl, world.seller.email);

    hdr('ownership: anon / owner / foreign on the buyer\'s order');
    const anon = (await authedFetch(orderUrl)).status;
    const own = (await authedFetch(orderUrl, { token: buyer.access })).status;
    const foreign = (await authedFetch(orderUrl, { token: buyer2.access })).status;

    hdr('role: buyer vs seller writing a product');
    const roleDenied = (
      await authedFetch(`${baseUrl}/products`, { method: 'POST', token: buyer.access, body: productBody })
    ).status;
    const roleAllowed = (
      await authedFetch(`${baseUrl}/products`, { method: 'POST', token: seller.access, body: { ...productBody, sku: `DEMO-${randomUUID()}` } })
    ).status;

    hdr('tampered token (payload role→admin, old signature) → signature check rejects it');
    const forged = forgeAdmin(buyer.access);
    const tampered = (
      await authedFetch(`${baseUrl}/products`, { method: 'POST', token: forged, body: { ...productBody, sku: `DEMO-${randomUUID()}` } })
    ).status;

    hdr('result');
    kv('anon', anon);
    kv('own', own);
    kv('foreign', foreign);
    kv('role-denied', roleDenied);
    kv('role-allowed', roleAllowed);
    kv('tampered', tampered);

    const ok =
      anon === 401 &&
      own === 200 &&
      foreign === 403 &&
      roleDenied === 403 &&
      (roleAllowed === 200 || roleAllowed === 201) &&
      tampered === 401;

    if (!ok) {
      note('INVARIANT VIOLATED: expected anon=401 own=200 foreign=403 role-denied=403 role-allowed=200|201 tampered=401');
    }

    return ok ? 0 : 1;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });