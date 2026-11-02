import 'reflect-metadata';

import { authedFetch, bootApp, seedWorld } from './helpers/auth-harness';
import { hdr, kv, note } from './helpers/output';

async function main(): Promise<number> {
  const { app, baseUrl, db } = await bootApp();

  try {
    const world = await seedWorld(db);
    const orderUrl = `${baseUrl}/orders/${world.orderId}`;

    hdr('login → access/refresh pair');
    const loginRes = await authedFetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      body: { email: world.buyer.email, password: 'demo-password-123' },
    });
    const loginStatus = loginRes.status;
    const tokens = (await loginRes.json()) as { access_token: string; refresh_token: string };

    hdr('protected read: without / with the access token');
    const noToken = (await authedFetch(orderUrl)).status;
    const withToken = (await authedFetch(orderUrl, { token: tokens.access_token })).status;

    hdr('refresh → a new pair');
    const refreshRes = await authedFetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      body: { refresh_token: tokens.refresh_token },
    });
    const refreshStatus = refreshRes.status;
    const next = (await refreshRes.json()) as { access_token: string; refresh_token: string };

    hdr('logout kills BOTH tokens (revoke refresh family + denylist access jti)');
    const logout = (
      await authedFetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        token: next.access_token,
        body: { refresh_token: next.refresh_token },
      })
    ).status;

    const afterLogout = (await authedFetch(orderUrl, { token: next.access_token })).status;
    const refreshAfterLogout = (
      await authedFetch(`${baseUrl}/auth/refresh`, { method: 'POST', body: { refresh_token: next.refresh_token } })
    ).status;

    hdr('result');
    kv('login', loginStatus);
    kv('no-token', noToken);
    kv('with-token', withToken);
    kv('refresh', refreshStatus);
    kv('logout', logout);
    kv('after-logout', afterLogout);
    kv('refresh-after-logout', refreshAfterLogout);

    const ok =
      loginStatus === 200 &&
      noToken === 401 &&
      withToken === 200 &&
      refreshStatus === 200 &&
      (logout === 200 || logout === 204) &&
      afterLogout === 401 &&
      refreshAfterLogout === 401;

    if (!ok) {
      note('INVARIANT VIOLATED: expected login=200 no-token=401 with-token=200 refresh=200 logout=200|204 after-logout=401 refresh-after-logout=401');
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