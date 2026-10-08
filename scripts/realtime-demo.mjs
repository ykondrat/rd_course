import { io } from 'socket.io-client';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3000';
const USER_ID = 1;
const PRODUCT_ID = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

setTimeout(() => {
  console.error('TIMEOUT — немає зʼєднання або події (чи піднятий API і чи зроблено seed?)');
  process.exit(1);
}, 15000).unref();

async function seedOrder() {
  const response = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify({ user_id: USER_ID, items: [{ product_id: PRODUCT_ID, quantity: 1 }] }),
  });

  if (response.status !== 201) throw new Error(`seed order failed: ${response.status} ${await response.text()}`);

  const order = await response.json();

  return order.id;
}

async function changeStatus(orderId, status) {
  const response = await fetch(`${API_URL}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });

  if (response.status !== 200) throw new Error(`patch status failed: ${response.status} ${await response.text()}`);
}

function connectAndJoin(name, orderId) {
  const socket = io(API_URL, { reconnectionDelay: 300, reconnectionDelayMax: 1000 });
  const received = { count: 0 };

  socket.on('order.status', (event) => {
    received.count += 1;
    console.log(`  [${name}] ← order.status: замовлення ${event.orderId} → ${event.status} (id ${event.id})`);
  });

  socket.io.on('reconnect_attempt', (attempt) => console.log(`[${name}] reconnect_attempt #${attempt}`));
  socket.io.on('reconnect', (attempt) => console.log(`[${name}] reconnect УСПІШНИЙ після ${attempt} спроб`));

  const ready = new Promise((resolve, reject) => {
    socket.on('connect', () => socket.emit('join', { orderId, userId: USER_ID }));
    socket.on('joined', (answer) => {
      console.log(`[${name}] у кімнаті «${answer.room}»`);
      resolve();
    });
    socket.on('join:denied', (answer) => reject(new Error(`[${name}] відмова join: ${answer.error}`)));
    socket.on('connect_error', reject);
  });

  return { socket, received, ready };
}

async function main() {
  const sameRoom = process.argv.includes('--same-room');

  const orderA = await seedOrder();
  const orderB = await seedOrder();

  const roomB = sameRoom ? orderA : orderB;
  const expectedB = sameRoom ? 1 : 0;

  console.log(`orderA=${orderA} orderB=${orderB} roomB=${roomB} (--same-room=${sameRoom})`);

  const clientA = connectAndJoin('A', orderA);
  const clientB = connectAndJoin('B', roomB);

  await Promise.all([clientA.ready, clientB.ready]);

  await changeStatus(orderA, 'paid');
  await sleep(500);

  clientA.socket.close();
  clientB.socket.close();

  const a = clientA.received.count > 0 ? 1 : 0;
  const b = clientB.received.count > 0 ? 1 : 0;

  console.log(`A_RECEIVED=${a}`);
  console.log(`B_RECEIVED=${b}`);

  process.exit(a === 1 && b === expectedB ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});