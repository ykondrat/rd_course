import { randomUUID } from 'node:crypto';

export const MiB = 1024 * 1024;

export const CONTENT_TYPE_ALLOWLIST: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/gzip': 'gz',
};

interface MagicBytes {
  offset: number;
  bytes: Buffer;
}

const ascii = (text: string): Buffer => Buffer.from(text, 'latin1');

export const CONTENT_SIGNATURES: Readonly<Record<string, readonly MagicBytes[]>> = {
  'image/png': [{ offset: 0, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
  'image/jpeg': [{ offset: 0, bytes: Buffer.from([0xff, 0xd8, 0xff]) }],
  'image/webp': [{ offset: 0, bytes: ascii('RIFF') }, { offset: 8, bytes: ascii('WEBP') }],
  'application/pdf': [{ offset: 0, bytes: ascii('%PDF-') }],
  'application/gzip': [{ offset: 0, bytes: Buffer.from([0x1f, 0x8b]) }],
};

export const SIGNATURE_PROBE_BYTES = 16;

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

export function matchesSignature(contentType: string, head: Buffer): boolean {
  if (!Object.hasOwn(CONTENT_SIGNATURES, contentType)) return false;

  return CONTENT_SIGNATURES[contentType].every(
    ({ offset, bytes }) => head.length >= offset + bytes.length && head.subarray(offset, offset + bytes.length).equals(bytes),
  );
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