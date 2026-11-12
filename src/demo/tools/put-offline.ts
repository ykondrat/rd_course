import { readFile } from 'node:fs/promises';

interface PutJob {
  url: string;
  filePath: string;
  contentType: string;
}

async function main(): Promise<void> {
  const job = JSON.parse(await readFile(String(process.argv[2]), 'utf8')) as PutJob;
  const body = await readFile(job.filePath);
  const response = await fetch(job.url, { method: 'PUT', body, headers: { 'content-type': job.contentType } });

  console.log(`STATUS ${response.status}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.log('STATUS 0');
  process.exit(1);
});
