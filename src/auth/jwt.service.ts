import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';

import { ACCESS_ALGORITHM, AUDIENCE, ISSUER, SIGNING_KEYS, SigningKeys } from './signing-keys';

export interface AccessClaims {
  sub: string;
  role: string;
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface IssuedAccess {
  token: string;
  jti: string;
  exp: number;
  expiresInSec: number;
}

@Injectable()
export class JwtService {
  constructor(@Inject(SIGNING_KEYS) private readonly keys: SigningKeys) {}

  issueAccess(userId: number, role: string): IssuedAccess {
    const jti = randomUUID();

    const token = jwt.sign({ role, jti }, this.keys.privateKey, {
      algorithm: ACCESS_ALGORITHM,
      subject: String(userId),
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.keys.accessTtlSec,
      keyid: this.keys.kid,
    });

    const { exp } = jwt.decode(token) as { exp: number };

    return { token, jti, exp, expiresInSec: this.keys.accessTtlSec };
  }

  verifyAccess(token: string): AccessClaims {
    const header = this.readHeader(token);
    const key = header?.kid ? this.keys.verifyKeys.get(header.kid) : undefined;

    if (!key) throw new Error(`unknown kid: ${header?.kid ?? '—'}`);

    return jwt.verify(token, key, {
      algorithms: [ACCESS_ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as unknown as AccessClaims;
  }

  private readHeader(token: string): { kid?: string } | null {
    const decoded = jwt.decode(token, { complete: true });

    return decoded ? (decoded.header as { kid?: string }) : null;
  }
}