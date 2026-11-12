import { randomUUID } from 'node:crypto';

export const MiB = 1024 * 1024;

export const CONTENT_TYPE_ALLOWLIST: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/gzip': 'gz',
};

export const PRESIGNED_PUT_TTL_SECONDS = 120;
export const PART_URL_TTL_SECONDS = 900;
export const DOWNLOAD_URL_TTL_SECONDS = 60;
export const MIN_PART_SIZE = 5 * MiB;
export const MAX_PART_SIZE = 5 * 1024 * MiB;
export const MAX_PARTS = 10_000;
export const MAX_FILE_SIZE = MAX_PARTS * MAX_PART_SIZE;
export const MULTIPART_THRESHOLD_BYTES = 2 * MIN_PART_SIZE;

export function extensionFor(contentType: string): string | undefined {
  return Object.hasOwn(CONTENT_TYPE_ALLOWLIST, contentType) ? CONTENT_TYPE_ALLOWLIST[contentType] : undefined;
}

export function buildObjectKey(userId: number, extension: string): string {
  return `uploads/${userId}/${randomUUID()}.${extension}`;
}

export function needsMultipart(size: number): boolean {
  return size > MULTIPART_THRESHOLD_BYTES;
}

export function partSizeFor(size: number): number {
  const smallestFitting = Math.ceil(size / MAX_PARTS);
  const roundedToMiB = Math.ceil(smallestFitting / MiB) * MiB;

  return Math.max(MIN_PART_SIZE, roundedToMiB);
}

export function partCountFor(size: number, partSize: number): number {
  return Math.ceil(size / partSize);
}