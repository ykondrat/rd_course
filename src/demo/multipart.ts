import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createStorage, headObject, listAllParts } from '../files/storage';
import { MiB, MULTIPART_THRESHOLD_BYTES } from '../files/upload-policy';
import { authedFetch, bootApp, login, seedWorld } from './helpers/auth-harness';
import { hdr, kv, note } from './helpers/output';
import { ensureBucket, lineValue, removeDir, resetUserFiles, runIsolated, writeJob } from './helpers/storage-harness';

const FILE_SIZE = 11 * MiB;
const DIE_AFTER = 2;

interface MultipartIntent {
  file_id: string;
  key: string;
  mode: string;
  upload_id: string;
  part_size: number;
  part_count: number;
  parts: { part_number: number; url: string }[];
}

function deterministicBytes(size: number): Buffer {
  const buffer = Buffer.alloc(size);

  for (let index = 0; index < size; index += 1) buffer[index] = (index * 31 + (index >> 20)) & 0xff;

  return buffer;
}

async function main(): Promise<number> {
  const storage = createStorage();
  const { app, baseUrl, db } = await bootApp();
  let tempDir: string | undefined;

  try {
    await ensureBucket(storage);
    const world = await seedWorld(db);
    await resetUserFiles(storage, db, world.buyer.id);

    hdr('intent — above the threshold the server opens a multipart upload');
    const { access } = await login(baseUrl, world.buyer.email);
    const body = deterministicBytes(FILE_SIZE);
    const response = await authedFetch(`${baseUrl}/uploads/intent`, {
      method: 'POST',
      token: access,
      body: { filename: 'backup.sql.gz', content_type: 'application/gzip', size: FILE_SIZE },
    });
    const intent = (await response.json()) as MultipartIntent;
    note(`threshold=${MULTIPART_THRESHOLD_BYTES} size=${FILE_SIZE} mode=${intent.mode} part_size=${intent.part_size} parts=${intent.part_count}`);

    const startJob = await writeJob({});
    tempDir = startJob.dir;
    const filePath = join(startJob.dir, 'backup.sql.gz');
    await writeFile(filePath, body);

    hdr('process #1 uploads two parts and dies (SIGKILL)');
    await writeFile(startJob.jobPath, JSON.stringify({ mode: 'start', filePath, partSize: intent.part_size, parts: intent.parts, dieAfter: DIE_AFTER }));
    const first = await runIsolated(join(__dirname, 'tools', 'mpu-worker.js'), [startJob.jobPath]);
    note(`process #1 exited by ${first.signal ?? `code ${first.code}`} after ${first.stdout.split('\n').filter((line) => line.startsWith('PART ')).length} parts`);

    hdr('before Complete the object does not exist, though parts are stored');
    const headBefore = await headObject(storage, intent.key);
    const partsOnServer = (await listAllParts(storage, intent.key, intent.upload_id)).length;
    note(`HeadObject -> ${headBefore.status}, ListParts -> ${partsOnServer} parts`);

    hdr('process #2 (fresh, remembers nothing) asks ListParts and uploads only what is missing');
    const resumeJob = await writeJob({ mode: 'resume', filePath, partSize: intent.part_size, baseUrl, token: access, fileId: intent.file_id });
    const second = await runIsolated(join(__dirname, 'tools', 'mpu-worker.js'), [resumeJob.jobPath]);
    await removeDir(resumeJob.dir);
    const resumedParts = Number(lineValue(second.stdout, 'RESUMED') ?? -1);
    note(`process #2: already=${lineValue(second.stdout, 'ALREADY')} resumed=${resumedParts}`);

    hdr('commit — ListParts → CompleteMultipartUpload → HeadObject');
    const commit = await authedFetch(`${baseUrl}/uploads/commit`, { method: 'POST', token: access, body: { file_id: intent.file_id } });
    const complete = commit.status;
    await commit.arrayBuffer();

    const headAfter = await headObject(storage, intent.key);
    const etag = String(headAfter.etag).replace(/"/g, '');
    const md5 = createHash('md5').update(body).digest('hex');
    const sizeMatch = headAfter.size === FILE_SIZE ? 1 : 0;
    const etagMultipart = etag.endsWith(`-${intent.part_count}`) && etag !== md5 ? 1 : 0;
    note(`etag=${etag} md5(file)=${md5}`);

    hdr('result');
    kv('parts-total', intent.part_count);
    kv('parts-before-crash', partsOnServer);
    kv('head-before-complete', headBefore.status);
    kv('resumed-parts', resumedParts);
    kv('complete', complete);
    kv('size-match', sizeMatch);
    kv('etag-multipart', etagMultipart);

    const ok =
      headBefore.status === 404 &&
      resumedParts === 1 &&
      complete === 200 &&
      sizeMatch === 1 &&
      etagMultipart === 1;

    if (!ok) note('INVARIANT VIOLATED: expected head-before-complete=404 resumed-parts=1 complete=200 size-match=1 etag-multipart=1');

    await resetUserFiles(storage, db, world.buyer.id);

    return ok ? 0 : 1;
  } finally {
    await app.close();
    if (tempDir) await removeDir(tempDir);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });