import { createHash } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import { Storage } from '../files/storage';

export const ASSETS_PREFIX = 'assets/';
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface PublishedAsset {
  name: string;
  key: string;
}

export function contentHash(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 8);
}

export async function publishAsset(
  storage: Storage,
  baseName: string,
  extension: string,
  body: string | Buffer,
  contentType: string,
): Promise<PublishedAsset> {
  const name = `${baseName}.${contentHash(body)}.${extension}`;
  const key = `${ASSETS_PREFIX}${name}`;

  await storage.s3.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );

  return { name, key };
}