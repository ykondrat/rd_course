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

export type RotateResult =
  | { status: 'ok'; userId: number; familyId: string; token: string }
  | { status: 'reuse'; familyId: string; userId: number; revoked: number }
  | { status: 'invalid' };

@Injectable()
export class RefreshRepository {
  hash(pepper: string, token: string): string {
    return createHmac('sha256', pepper).update(token).digest('hex');
  }

  async issueFamily(db: Queryable, pepper: string, userId: number, ttlSec: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');

    await db.query(
      `INSERT INTO refresh_tokens (family_id, user_id, token_hash, expires_at)
       VALUES (gen_random_uuid(), $1, $2, now() + make_interval(secs => $3))`,
      [userId, this.hash(pepper, token), ttlSec],
    );

    return token;
  }

  async rotate(db: Queryable, pepper: string, token: string, ttlSec: number): Promise<RotateResult> {
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
      const revoked = await this.revokeFamily(db, row.family_id);

      return { status: 'reuse', familyId: row.family_id, userId: row.user_id, revoked };
    }

    const next = randomBytes(32).toString('base64url');

    await db.query(
      `INSERT INTO refresh_tokens (family_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [row.family_id, row.user_id, this.hash(pepper, next), ttlSec],
    );

    return { status: 'ok', userId: row.user_id, familyId: row.family_id, token: next };
  }

  async revokeFamily(db: Queryable, familyId: string): Promise<number> {
    const r = await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );

    return r.rowCount ?? 0;
  }

  async familyOf(db: Queryable, pepper: string, token: string): Promise<string | null> {
    const { rows } = await db.query(
      `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
      [this.hash(pepper, token)],
    );

    return rows[0] ? (rows[0].family_id as string) : null;
  }
}