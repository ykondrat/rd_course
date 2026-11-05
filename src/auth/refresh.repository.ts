import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

import { Queryable } from '../common/queryable';

interface RefreshRow {
  id: string;
  family_id: string;
  user_id: number;
  used_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}

export interface IssueRefresh {
  familyId: string;
  userId: number;
  ttlSec: number;
  accessJti: string;
  accessExpEpochSec: number;
}

export type ClaimResult =
  | { status: 'ok'; userId: number; familyId: string }
  | { status: 'reuse'; familyId: string; userId: number }
  | { status: 'invalid' };

@Injectable()
export class RefreshRepository {
  hash(pepper: string, token: string): string {
    return createHmac('sha256', pepper).update(token).digest('hex');
  }

  async issue(db: Queryable, pepper: string, p: IssueRefresh): Promise<string> {
    const token = randomBytes(32).toString('base64url');

    await db.query(
      `INSERT INTO refresh_tokens (family_id, user_id, token_hash, expires_at, access_jti, access_expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, to_timestamp($6))`,
      [p.familyId, p.userId, this.hash(pepper, token), p.ttlSec, p.accessJti, p.accessExpEpochSec],
    );

    return token;
  }

  async claim(db: Queryable, pepper: string, token: string): Promise<ClaimResult> {
    const found = await db.query(
      `SELECT id, family_id, user_id, used_at, revoked_at, expires_at
         FROM refresh_tokens WHERE token_hash = $1`,
      [this.hash(pepper, token)],
    );
    const row = found.rows[0] as RefreshRow | undefined;

    if (!row || row.revoked_at !== null || new Date(row.expires_at).getTime() <= Date.now()) {
      return { status: 'invalid' };
    }

    const claim = await db.query(
      `UPDATE refresh_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`,
      [row.id],
    );

    if ((claim.rowCount ?? 0) === 0) {
      return { status: 'reuse', familyId: row.family_id, userId: Number(row.user_id) };
    }

    return { status: 'ok', userId: Number(row.user_id), familyId: row.family_id };
  }

  async revokeFamily(db: Queryable, familyId: string): Promise<number> {
    const r = await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );

    return r.rowCount ?? 0;
  }
}