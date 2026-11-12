import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

import { Queryable } from '../../common/queryable';
import { statusOf, Storage } from '../../files/storage';

export function isPortAlive(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });

    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

export async function ensureBucket(storage: Storage): Promise<void> {
  try {
    await storage.s3.send(new HeadBucketCommand({ Bucket: storage.bucket }));
  } catch (error) {
    if (statusOf(error) !== 404) throw error;

    await storage.s3.send(new CreateBucketCommand({ Bucket: storage.bucket }));
  }
}

export async function abortUploads(storage: Storage, prefix: string): Promise<number> {
  let aborted = 0;
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;

  do {
    const page = await storage.s3.send(
      new ListMultipartUploadsCommand({ Bucket: storage.bucket, Prefix: prefix, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker }),
    );

    for (const upload of page.Uploads ?? []) {
      await storage.s3.send(
        new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: String(upload.Key), UploadId: String(upload.UploadId) }),
      );
      aborted += 1;
    }

    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);

  return aborted;
}

export async function deletePrefix(storage: Storage, prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined;

  do {
    const page = await storage.s3.send(
      new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: prefix, ContinuationToken: token }),
    );
    const keys = (page.Contents ?? []).map((object) => ({ Key: String(object.Key) }));

    if (keys.length > 0) {
      await storage.s3.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return deleted;
}

export async function resetUserFiles(storage: Storage, db: Queryable, userId: number): Promise<void> {
  const prefix = `uploads/${userId}/`;

  await abortUploads(storage, prefix);
  await deletePrefix(storage, prefix);
  await db.query(`DELETE FROM files WHERE owner_id = $1`, [userId]);
}

export async function writeJob(job: unknown): Promise<{ dir: string; jobPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hw26-'));
  const jobPath = join(dir, 'job.json');

  await writeFile(jobPath, JSON.stringify(job), { mode: 0o600 });

  return { dir, jobPath };
}

export function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

export interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
}

export function runIsolated(scriptPath: string, args: string[]): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { env: {}, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout }));
  });
}

export function lineValue(stdout: string, key: string): string | undefined {
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(`${key} `));

  return line?.slice(key.length + 1).trim();
}