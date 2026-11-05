import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AppError } from '../common/problem';
import { Queryable } from '../common/queryable';
import { DatabaseService } from '../database/database.service';
import { Principal } from './current-user.decorator';
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

    return this.issuePair(this.db, Number(user.id), user.role, randomUUID());
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const result = await this.db.withTransaction(async (client: Queryable) => {
      const out = await this.refresh.claim(client, this.keys.pepper, refreshToken);

      if (out.status === 'reuse') {
        const revoked = await this.revokeSession(client, out.familyId);

        this.logger.warn(
          `refresh_reuse_detected family=${out.familyId} user=${out.userId} revoked=${revoked.refresh} denylisted=${revoked.access}`,
        );

        return null;
      }

      if (out.status === 'invalid') return null;

      const u = await client.query(`SELECT role FROM users WHERE id = $1`, [out.userId]);

      return this.issuePair(client, out.userId, u.rows[0].role, out.familyId);
    });

    if (!result) throw new AppError(401, 'Refresh token rejected.', { code: 'refresh-rejected' });

    return result;
  }

  async logout(me: Principal): Promise<{ refresh_family_revoked: number; access_denylisted: boolean }> {
    return this.db.withTransaction(async (client: Queryable) => {
      let familyRevoked = 0;

      if (me.sid) familyRevoked = (await this.revokeSession(client, me.sid)).refresh;

      await this.denylist.deny(client, me.jti, me.exp);
      await this.denylist.cleanupExpired(client);

      return { refresh_family_revoked: familyRevoked, access_denylisted: true };
    });
  }

  private async issuePair(db: Queryable, userId: number, role: string, familyId: string): Promise<TokenPair> {
    const access = this.jwt.issueAccess(userId, role, familyId);
    const token = await this.refresh.issue(db, this.keys.pepper, {
      familyId,
      userId,
      ttlSec: this.keys.refreshTtlSec,
      accessJti: access.jti,
      accessExpEpochSec: access.exp,
    });

    return this.pair(access.token, access.expiresInSec, token);
  }

  private async revokeSession(db: Queryable, familyId: string): Promise<{ refresh: number; access: number }> {
    const refresh = await this.refresh.revokeFamily(db, familyId);
    const access = await this.denylist.denyFamily(db, familyId);

    return { refresh, access };
  }

  private pair(accessToken: string, expiresInSec: number, refreshToken: string): TokenPair {
    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: expiresInSec };
  }
}