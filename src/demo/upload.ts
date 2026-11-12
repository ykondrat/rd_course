import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createStorage, presignPut, swapKeyInUrl } from '../files/storage';
import { authedFetch, bootApp, BootedApp, login, seedWorld } from './helpers/auth-harness';
import { hdr, kv, note, sleep } from './helpers/output';
import { ensureBucket, isPortAlive, lineValue, removeDir, resetUserFiles, runIsolated, writeJob } from './helpers/storage-harness';

const EVIL_FILENAME = '../../etc/passwd';
const CONTENT_TYPE = 'image/png';
const SERVER_KEY_PATTERN = /^uploads\/\d+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 0x2a)]);

interface SingleIntent {
  file_id: string;
  key: string;
  url: string;
}

async function postIntent(baseUrl: string, token: string, filename: string): Promise<{ status: number; body: SingleIntent }> {
  const response = await authedFetch(`${baseUrl}/uploads/intent`, {
    method: 'POST',
    token,
    body: { filename, content_type: CONTENT_TYPE, size: PNG_BYTES.length },
  });

  return { status: response.status, body: (await response.json()) as SingleIntent };
}

async function postCommit(baseUrl: string, token: string, fileId: string): Promise<number> {
  const response = await authedFetch(`${baseUrl}/uploads/commit`, { method: 'POST', token, body: { file_id: fileId } });

  await response.arrayBuffer();

  return response.status;
}

async function putBytes(url: string): Promise<number> {
  const response = await fetch(url, { method: 'PUT', body: PNG_BYTES, headers: { 'content-type': CONTENT_TYPE } });

  await response.arrayBuffer();

  return response.status;
}

async function main(): Promise<number> {
  const storage = createStorage();
  let booted: BootedApp | undefined = await bootApp();
  let rebooted: BootedApp | undefined;
  let tempDir: string | undefined;

  try {
    await ensureBucket(storage);

    const world = await seedWorld(booted.db);
    await resetUserFiles(storage, booted.db, world.buyer.id);

    hdr('intent — the server generates the key, filename is ignored');
    const { access } = await login(booted.baseUrl, world.buyer.email);
    const intent = await postIntent(booted.baseUrl, access, EVIL_FILENAME);
    const keyFromServer = SERVER_KEY_PATTERN.test(intent.body.key) && !intent.body.key.includes('passwd') && !intent.body.key.includes('..') ? 1 : 0;
    note(`filename=${EVIL_FILENAME} -> key=${intent.body.key}`);

    hdr('stop our API, PUT from a separate process with no credentials');
    const firstPort = Number(new URL(booted.baseUrl).port);
    await booted.app.close();
    booted = undefined;
    const apiAlive = (await isPortAlive(firstPort)) ? 1 : 0;

    const job = await writeJob({ url: intent.body.url, filePath: '', contentType: CONTENT_TYPE });
    tempDir = job.dir;
    const filePath = join(job.dir, 'avatar.png');
    await writeFile(filePath, PNG_BYTES);
    await writeFile(job.jobPath, JSON.stringify({ url: intent.body.url, filePath, contentType: CONTENT_TYPE }));
    const putChild = await runIsolated(join(__dirname, 'tools', 'put-offline.js'), [job.jobPath]);
    const putOffline = Number(lineValue(putChild.stdout, 'STATUS') ?? 0);
    note(`api port ${firstPort} alive=${apiAlive}, isolated PUT -> ${putOffline}`);

    hdr('bring the API back on a NEW port and commit');
    rebooted = await bootApp();
    note(`api moved ${firstPort} -> ${new URL(rebooted.baseUrl).port}`);
    const commit = await postCommit(rebooted.baseUrl, access, intent.body.file_id);

    hdr('302 to a fresh presigned GET');
    const redirect = await fetch(`${rebooted.baseUrl}/files/${intent.body.file_id}`, {
      headers: { authorization: `Bearer ${access}` },
      redirect: 'manual',
    });
    const download = redirect.status;
    const downloaded = Buffer.from(await (await fetch(String(redirect.headers.get('location')))).arrayBuffer());
    const downloadMatch = downloaded.equals(PNG_BYTES) ? 1 : 0;

    hdr('commit without bytes');
    const emptyIntent = await postIntent(rebooted.baseUrl, access, 'empty.png');
    const commitWithoutBytes = await postCommit(rebooted.baseUrl, access, emptyIntent.body.file_id);

    hdr('tampered key in a presigned URL');
    const tamperedUrl = swapKeyInUrl(emptyIntent.body.url, emptyIntent.body.key, `uploads/${world.buyer.id}/hijacked.png`);
    const tampered = await putBytes(tamperedUrl);

    hdr('expired presigned URL — the same URL, before and after its lifetime');
    const shortUrl = await presignPut(storage, emptyIntent.body.key, CONTENT_TYPE, PNG_BYTES.length, 2);
    const fresh = await putBytes(shortUrl);
    await sleep(4000);
    const expired = await putBytes(shortUrl);

    hdr('result');
    kv('intent', intent.status);
    kv('key-from-server', keyFromServer);
    kv('api-alive', apiAlive);
    kv('put-offline', putOffline);
    kv('commit', commit);
    kv('download', download);
    kv('download-match', downloadMatch);
    kv('commit-without-bytes', commitWithoutBytes);
    kv('tampered', tampered);
    kv('fresh', fresh);
    kv('expired', expired);

    const ok =
      intent.status === 200 &&
      keyFromServer === 1 &&
      apiAlive === 0 &&
      putOffline === 200 &&
      commit === 200 &&
      commitWithoutBytes >= 400 && commitWithoutBytes < 500 &&
      tampered === 403 &&
      expired === 403;

    if (!ok) note('INVARIANT VIOLATED: expected intent=200 key-from-server=1 api-alive=0 put-offline=200 commit=200 commit-without-bytes=4xx tampered=403 expired=403');

    return ok ? 0 : 1;
  } finally {
    if (booted) await booted.app.close();
    if (rebooted) await rebooted.app.close();
    if (tempDir) await removeDir(tempDir);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
