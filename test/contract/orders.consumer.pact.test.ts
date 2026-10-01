import path from 'node:path';

import { PactV3, MatchersV3 } from '@pact-foundation/pact';

const { integer, like, eachLike, regex } = MatchersV3;

describe('Contract (consumer): web-app describes its expectations of marketplace-api', () => {
  const provider = new PactV3({
    consumer: 'web-app',
    provider: 'marketplace-api',
    dir: path.resolve(process.cwd(), 'pacts'),
  });

  it('GET /orders/7 in the "order 7 exists" state returns an Order matching the spec #9 schema', async () => {
    provider
      .given('order 7 exists')
      .uponReceiving('request order 7')
      .withRequest({ method: 'GET', path: '/orders/7' })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': regex('application/json.*', 'application/json; charset=utf-8') },
        body: {
          id: integer(7),
          user_id: integer(7),
          items: eachLike({
            product_id: integer(7),
            quantity: integer(2),
            line_total_cents: integer(30000),
          }),
          status: like('new'),
          total_cents: integer(30000),
          currency: regex('^[A-Z]{3}$', 'USD'),
          created_at: like('2026-08-20T10:05:00.000Z'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/orders/7`);

      expect(res.status).toBe(200);

      const body = (await res.json()) as { id: number; currency: string };

      expect(body).toMatchObject({ id: 7, currency: 'USD' });
    });
  });
});
