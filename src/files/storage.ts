import {
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { loadStorageEnv, type StorageEnv } from '../config/env.schema';

export interface Storage {
  s3: S3Client;
  bucket: string;
  region: string;
  endpoint: string;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export function createStorage(env: StorageEnv = loadStorageEnv()): Storage {
  const s3 = new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  return { s3, bucket: env.STORAGE_BUCKET, region: env.STORAGE_REGION, endpoint: env.STORAGE_ENDPOINT };
}

export function statusOf(error: unknown): number {
  const metadata = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata;

  return metadata?.httpStatusCode ?? 500;
}

export function presignPut(
  storage: Storage,
  key: string,
  contentType: string,
  size: number,
  expiresIn: number,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: storage.bucket, Key: key, ContentType: contentType, ContentLength: size });

  return getSignedUrl(storage.s3, command, { expiresIn });
}

export function presignPart(
  storage: Storage,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn: number,
): Promise<string> {
  const command = new UploadPartCommand({ Bucket: storage.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber });

  return getSignedUrl(storage.s3, command, { expiresIn });
}

export function presignGet(storage: Storage, key: string, expiresIn: number): Promise<string> {
  const command = new GetObjectCommand({ Bucket: storage.bucket, Key: key });

  return getSignedUrl(storage.s3, command, { expiresIn });
}

export async function headObject(
  storage: Storage,
  key: string,
): Promise<{ status: number; size?: number; etag?: string; cacheControl?: string }> {
  try {
    const head = await storage.s3.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));

    return { status: 200, size: head.ContentLength, etag: head.ETag, cacheControl: head.CacheControl };
  } catch (error) {
    return { status: statusOf(error) };
  }
}

export async function listAllParts(storage: Storage, key: string, uploadId: string): Promise<UploadedPart[]> {
  const parts: UploadedPart[] = [];
  let marker: string | undefined;

  do {
    const page = await storage.s3.send(
      new ListPartsCommand({ Bucket: storage.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
    );

    for (const part of page.Parts ?? []) {
      parts.push({ partNumber: Number(part.PartNumber), etag: String(part.ETag), size: Number(part.Size) });
    }

    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);

  return parts.sort((left, right) => left.partNumber - right.partNumber);
}

export function directObjectUrl(storage: Storage, key: string): string {
  return `${storage.endpoint.replace(/\/+$/, '')}/${storage.bucket}/${key}`;
}

export function swapKeyInUrl(signedUrl: string, fromKey: string, toKey: string): string {
  const url = new URL(signedUrl);

  url.pathname = url.pathname.replace(fromKey, toKey);

  return url.toString();
}