import 'reflect-metadata';

import { authedFetch, bootApp, login, seedWorld } from './helpers/auth-harness';
import { hdr, kv, note } from './helpers/output';

async function refresh(baseUrl: string, token: string): Promise<{ status: number; next?: string }> {
  const res = await authedFetch(`${baseUrl}/auth/refresh`, { method: 'POST', body: { refresh_token: token } });

  if (res.status !== 200) return { status: res.status };

  const body = (await res.json()) as { refresh_token: string };

  return { status: res.status, next: body.refresh_token };
}

async function main(): Promise<number> {
  const { app, baseUrl, db } = await bootApp();

  try {
    const world = await seedWorld(db);

    hdr('login → R1');
    const first = await login(baseUrl, world.buyer.email);
    const loginStatus = first.access ? 200 : 0;
    const r1 = first.refresh;

    hdr('refresh R1 → R2 (honest rotation)');
    const rotated = await refresh(baseUrl, r1);
    const r2 = rotated.next;

    hdr('reuse R1 (already spent) → whole family revoked');
    const reuse = await refresh(baseUrl, r1);

    hdr('R2 (the honest new token) is now dead too — that is the point');
    const r2AfterReuse = r2 ? await refresh(baseUrl, r2) : { status: 0 };

    hdr('result');
    kv('login', loginStatus);
    kv('r1-refresh', rotated.status);
    kv('r1-reuse', reuse.status);
    kv('r2-after-reuse', r2AfterReuse.status);

    const ok =
      loginStatus === 200 &&
      rotated.status === 200 &&
      reuse.status === 401 &&
      r2AfterReuse.status === 401;

    if (!ok) {
      note('INVARIANT VIOLATED: expected login=200 r1-refresh=200 r1-reuse=401 r2-after-reuse=401');
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