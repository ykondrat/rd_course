import { createHash, createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { Logger } from '@nestjs/common';

import { loadAuthEnv } from '../config/env.schema';

export const ISSUER = 'marketplace-api';
export const AUDIENCE = 'marketplace-clients';
export const ACCESS_ALGORITHM = 'ES256' as const;

export const SIGNING_KEYS = Symbol('SIGNING_KEYS');

export interface SigningKeys {
  privateKey: KeyObject;
  verifyKeys: Map<string, KeyObject>;
  kid: string;
  pepper: string;
  accessTtlSec: number;
  refreshTtlSec: number;
}

const fromBase64Pem = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');

const fingerprint = (key: KeyObject): string =>
  createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

export function loadSigningKeys(): SigningKeys {
  const env = loadAuthEnv();
  const privateKey = createPrivateKey(fromBase64Pem(env.JWT_PRIVATE_KEY));
  const publicKey = createPublicKey(fromBase64Pem(env.JWT_PUBLIC_KEY));
  const verifyKeys = new Map<string, KeyObject>([[env.JWT_KID, publicKey]]);

  new Logger('Auth').log(`signing key loaded: kid=${env.JWT_KID} fp=${fingerprint(publicKey)}`);

  return {
    privateKey,
    verifyKeys,
    kid: env.JWT_KID,
    pepper: env.REFRESH_TOKEN_PEPPER,
    accessTtlSec: env.JWT_ACCESS_TTL,
    refreshTtlSec: env.JWT_REFRESH_TTL,
  };
}
