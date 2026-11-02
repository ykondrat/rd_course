import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppError } from '../common/problem';
import { Queryable } from '../common/queryable';
import { DatabaseService } from '../database/database.service';
import { DenylistRepository } from './denylist.repository';
import { JwtService } from './jwt.service';
import { verifyPassword } from './password';
import { RefreshRepository } from './refresh.repository';
import { SIGNING_KEYS, SigningKeys } from './signing-keys';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly refresh: RefreshRepository,
    private readonly denylist: DenylistRepository,
    @Inject(SIGNING_KEYS) private readonly keys: SigningKeys,
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    const { rows } = await this.db.query(
      `SELECT id, role, password_hash, is_active FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];

    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      throw new AppError(401, 'Invalid credentials.', { code: 'invalid-credentials' });
    }

    const token = await this.refresh.issueFamily(this.db, this.keys.pepper, Number(user.id), this.keys.refreshTtlSec);
    const access = this.jwt.issueAccess(Number(user.id), user.role);

    return this.pair(access.token, access.expiresInSec, token);
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const result = await this.db.withTransaction(async (client: Queryable) => {
      const out = await this.refresh.rotate(client, this.keys.pepper, refreshToken, this.keys.refreshTtlSec);

      if (out.status === 'reuse') {
        this.logger.warn(`refresh_reuse_detected family=${out.familyId} user=${out.userId} revoked=${out.revoked}`);

        return null;
      }

      if (out.status === 'invalid') return null;

      const u = await client.query(`SELECT role FROM users WHERE id = $1`, [out.userId]);
      const access = this.jwt.issueAccess(out.userId, u.rows[0].role);

      return this.pair(access.token, access.expiresInSec, out.token);
    });

    if (!result) throw new AppError(401, 'Refresh token rejected.', { code: 'refresh-rejected' });

    return result;
  }

  async logout(
    jti: string,
    accessExpEpochSec: number,
    refreshToken: string | undefined,
  ): Promise<{ refresh_family_revoked: number; access_denylisted: boolean }> {
    return this.db.withTransaction(async (client: Queryable) => {
      let familyRevoked = 0;

      if (refreshToken) {
        const familyId = await this.refresh.familyOf(client, this.keys.pepper, refreshToken);

        if (familyId) familyRevoked = await this.refresh.revokeFamily(client, familyId);
      }

      await this.denylist.deny(client, jti, accessExpEpochSec);
      await this.denylist.cleanupExpired(client);

      return { refresh_family_revoked: familyRevoked, access_denylisted: true };
    });
  }

  private pair(accessToken: string, expiresInSec: number, refreshToken: string): TokenPair {
    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: expiresInSec };
  }
}
