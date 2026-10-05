import 'reflect-metadata';

import path from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Verifier, VerifierOptions } from '@pact-foundation/pact';

import { PgHandle, startPg } from '../integration/testkit/pg-container';
import { applyContainerEnv } from '../integration/testkit/app-env';

const SEED_ORDER_7 = `
  INSERT INTO users (id, email, full_name)
    OVERRIDING SYSTEM VALUE VALUES (7, 'contract-user@example.com', 'Contract User')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO products (id, title, price_cents, currency, sku)
    OVERRIDING SYSTEM VALUE VALUES (7, 'Contract Product', 15000, 'USD', 'CONTRACT-SKU-7')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO orders (id, user_id, currency, total_cents, status)
    OVERRIDING SYSTEM VALUE VALUES (7, 7, 'USD', 30000, 'new')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, line_total_cents)
    OVERRIDING SYSTEM VALUE VALUES (7, 7, 7, 2, 15000, 30000)
    ON CONFLICT (id) DO NOTHING;
`;

describe('Contract (provider): marketplace-api satisfies the web-app contract', () => {
  let pg: PgHandle;
  let app: INestApplication;
  let providerBaseUrl: string;

  beforeAll(async () => {
    pg = await startPg('(provider)');
    applyContainerEnv(pg.connection);

    const { createApp } = await import('../../src/main');

    app = await createApp();

    await app.listen(0);

    const { port } = new URL(await app.getUrl());

    providerBaseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  it('all contract interactions pass (real app against a real DB)', async () => {
    const brokerUrl = process.env.PACT_BROKER_URL;

    const options: VerifierOptions = {
      provider: 'marketplace-api',
      providerBaseUrl,
      logLevel: 'warn',
      stateHandlers: {
        'order 7 exists': async () => {
          await pg.pool.query(SEED_ORDER_7);
        },
      },
    };

    if (brokerUrl) {
      options.pactBrokerUrl = brokerUrl;

      if (process.env.PACT_BROKER_TOKEN) {
        options.pactBrokerToken = process.env.PACT_BROKER_TOKEN;
      }

      options.consumerVersionSelectors = [{ latest: true }];
      options.publishVerificationResult = true;
      options.providerVersion = process.env.PROVIDER_VERSION ?? '1.0.0';
      options.providerVersionBranch = process.env.PROVIDER_VERSION_BRANCH ?? 'main';
    } else {
      options.pactUrls = [path.resolve(process.cwd(), 'pacts', 'web-app-marketplace-api.json')];
    }

    const output = await new Verifier(options).verifyProvider();

    console.log('verifier output:\n', output);
  });
});
