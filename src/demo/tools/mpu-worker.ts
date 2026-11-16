import { open, readFile } from 'node:fs/promises';

interface PartUrl {
  part_number: number;
  url: string;
}

interface WorkerJob {
  mode: 'start' | 'resume';
  filePath: string;
  partSize: number;
  parts?: PartUrl[];
  dieAfter?: number;
  baseUrl?: string;
  token?: string;
  fileId?: string;
}

async function readPart(filePath: string, partNumber: number, partSize: number): Promise<Buffer<ArrayBuffer>> {
  const handle = await open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(partSize);
    const { bytesRead } = await handle.read(buffer, 0, partSize, (partNumber - 1) * partSize);

    return Buffer.from(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function uploadPart(job: WorkerJob, part: PartUrl): Promise<void> {
  const body = await readPart(job.filePath, part.part_number, job.partSize);
  const response = await fetch(part.url, { method: 'PUT', body });

  if (response.status !== 200) throw new Error(`part ${part.part_number} failed with ${response.status}`);

  console.log(`PART ${part.part_number}`);
}

async function start(job: WorkerJob): Promise<void> {
  let uploaded = 0;

  for (const part of job.parts ?? []) {
    await uploadPart(job, part);
    uploaded += 1;

    if (job.dieAfter && uploaded >= job.dieAfter) {
      console.log('DIE');
      process.kill(process.pid, 'SIGKILL');
    }
  }
}

async function resume(job: WorkerJob): Promise<void> {
  const response = await fetch(`${job.baseUrl}/uploads/${job.fileId}/parts`, {
    headers: { authorization: `Bearer ${job.token}` },
  });
  const state = (await response.json()) as { uploaded: number[]; missing: PartUrl[] };

  console.log(`ALREADY ${state.uploaded.length}`);

  for (const part of state.missing) await uploadPart(job, part);

  console.log(`RESUMED ${state.missing.length}`);
}

async function main(): Promise<void> {
  const job = JSON.parse(await readFile(String(process.argv[2]), 'utf8')) as WorkerJob;

  if (job.mode === 'start') await start(job);
  else await resume(job);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});