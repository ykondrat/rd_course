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

export const WORK_QUEUE_ARGS = { ...QUORUM, 'x-dead-letter-exchange': X.dlx } as const;

export const PREFETCH = 10;

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

  await assertWorkQueue(conn, ch);

  const bindCh = await conn.createChannel();
  await bindCh.bindQueue(Q.orderPlaced, X.events, RK.orderPlaced);
  await bindCh.close().catch(() => {});
}

async function assertWorkQueue(conn: ChannelModel, ch: Channel): Promise<void> {
  try {
    await ch.assertQueue(Q.orderPlaced, { durable: true, arguments: { ...WORK_QUEUE_ARGS } });
    await ch.close().catch(() => {});
  } catch (err) {
    if (!isPreconditionFailed(err)) throw err;

    const retry = await conn.createChannel();

    await retry.deleteQueue(Q.orderPlaced);
    await retry.assertQueue(Q.orderPlaced, { durable: true, arguments: { ...WORK_QUEUE_ARGS } });
    await retry.close().catch(() => {});
  }
}

function isPreconditionFailed(err: unknown): boolean {
  return err instanceof Error && /PRECONDITION[-_ ]FAILED|406/i.test(err.message);
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

export const kv = (key: string, value: string | number): void => console.log(`${key}=${value}`);
export const note = (s: string): void => console.log(`   ${s}`);
export const hdr = (s: string): void => console.log(`\n── ${s}`);
