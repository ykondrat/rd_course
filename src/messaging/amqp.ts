import * as amqp from 'amqplib';
import type { Channel, ChannelModel, ConfirmChannel } from 'amqplib';

import { loadBrokerEnv } from '../config/env.schema';

export const BROKER_URL = loadBrokerEnv().BROKER_URL;

export const X = {
  events: 'shop.events',
  dlx: 'shop.events.dlx',
} as const;

export const Q = {
  orderPlaced: 'orders.order-placed',
  dlq: 'orders.order-placed.dlq',
} as const;

export const RK = {
  orderPlaced: 'order.placed',
} as const;

export const QUORUM = { 'x-queue-type': 'quorum' } as const;

export const PREFETCH = 10;

export const VHOST = '%2F';

const DLX_POLICY = 'orders-order-placed-dlx';

export function connect(): Promise<ChannelModel> {
  return amqp.connect(BROKER_URL);
}

export async function withChannel<T>(fn: (ch: Channel) => Promise<T>): Promise<T> {
  const conn = await connect();
  const ch = await conn.createChannel();

  try {
    return await fn(ch);
  } finally {
    await ch.close().catch(() => {});
    await conn.close().catch(() => {});
  }
}

export async function withConfirmChannel<T>(fn: (ch: ConfirmChannel) => Promise<T>): Promise<T> {
  const conn = await connect();
  const ch = await conn.createConfirmChannel();

  try {
    return await fn(ch);
  } finally {
    await ch.close().catch(() => {});
    await conn.close().catch(() => {});
  }
}

export async function assertTopology(conn: ChannelModel): Promise<void> {
  const ch = await conn.createChannel();

  await ch.assertExchange(X.events, 'topic', { durable: true });
  await ch.assertExchange(X.dlx, 'fanout', { durable: true });
  await ch.assertQueue(Q.dlq, { durable: true, arguments: { ...QUORUM } });
  await ch.bindQueue(Q.dlq, X.dlx, '');
  await ch.close().catch(() => {});

  await ensureWorkQueue(conn);

  const bindCh = await conn.createChannel();
  await bindCh.bindQueue(Q.orderPlaced, X.events, RK.orderPlaced);
  await bindCh.close().catch(() => {});

  await setDlxPolicy();
  await waitForDlxPolicy();
}

async function ensureWorkQueue(conn: ChannelModel): Promise<void> {
  if (await workQueueExists()) return;

  const ch = await conn.createChannel();

  await ch.assertQueue(Q.orderPlaced, { durable: true, arguments: { ...QUORUM } });
  await ch.close().catch(() => {});
}

async function workQueueExists(): Promise<boolean> {
  const res = await mgmt('GET', `/queues/${VHOST}/${encodeURIComponent(Q.orderPlaced)}`);

  return res.ok;
}

function managementTarget(): { base: string; auth: string } {
  const u = new URL(BROKER_URL);
  const user = decodeURIComponent(u.username) || 'guest';
  const pass = decodeURIComponent(u.password) || 'guest';

  return {
    base: `http://${u.hostname}:15672/api`,
    auth: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
  };
}

async function mgmt(method: 'GET' | 'PUT', path: string, payload?: unknown) {
  const { base, auth } = managementTarget();

  return fetch(`${base}${path}`, {
    method,
    headers: { authorization: auth, ...(payload ? { 'content-type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function setDlxPolicy(): Promise<void> {
  const res = await mgmt('PUT', `/policies/${VHOST}/${DLX_POLICY}`, {
    pattern: `^${escapeRegExp(Q.orderPlaced)}$`,
    'apply-to': 'queues',
    priority: 1,
    definition: { 'dead-letter-exchange': X.dlx },
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`set DLX policy failed: ${res.status} ${await res.text()}`);
  }
}

async function waitForDlxPolicy(): Promise<void> {
  await waitFor('DLX policy effective on the work queue', async () => {
    const res = await mgmt('GET', `/queues/${VHOST}/${encodeURIComponent(Q.orderPlaced)}`);

    if (!res.ok) return false;

    const queue = (await res.json()) as { effective_policy_definition?: Record<string, unknown> };

    return queue.effective_policy_definition?.['dead-letter-exchange'] === X.dlx;
  });
}

export async function depth(ch: Channel, queue: string): Promise<number> {
  const r = await ch.checkQueue(queue);

  return r.messageCount;
}


export const body = (o: unknown): Buffer => Buffer.from(JSON.stringify(o));
export const parse = <T = unknown>(b: Buffer): T => JSON.parse(b.toString()) as T;
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function waitFor(
  what: string,
  cond: () => Promise<boolean> | boolean,
  timeoutMs = 15_000,
  everyMs = 25,
): Promise<void> {
  const deadline = startDeadline(timeoutMs);

  for (;;) {
    if (await cond()) return;
    if (deadline()) throw new Error(`timed out waiting for: ${what} (${timeoutMs} ms)`);
    await sleep(everyMs);
  }
}

function startDeadline(timeoutMs: number): () => boolean {
  const t0 = Date.now();

  return () => Date.now() - t0 > timeoutMs;
}
