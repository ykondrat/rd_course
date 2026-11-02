import { Injectable } from '@nestjs/common';

import { Queryable } from '../common/queryable';

@Injectable()
export class DenylistRepository {
  async deny(db: Queryable, jti: string, expEpochSec: number): Promise<void> {
    await db.query(
      `INSERT INTO access_denylist (jti, expires_at) VALUES ($1, to_timestamp($2))
       ON CONFLICT (jti) DO NOTHING`,
      [jti, expEpochSec],
    );
  }

  async isDenied(db: Queryable, jti: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `SELECT 1 FROM access_denylist WHERE jti = $1 AND expires_at > now()`,
      [jti],
    );

    return (rowCount ?? 0) > 0;
  }

  async cleanupExpired(db: Queryable): Promise<void> {
    await db.query(`DELETE FROM access_denylist WHERE expires_at <= now()`);
  }
}