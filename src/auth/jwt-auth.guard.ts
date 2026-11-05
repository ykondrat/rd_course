import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { AppError } from '../common/problem';
import { DatabaseService } from '../database/database.service';
import { Principal } from './current-user.decorator';
import { DenylistRepository } from './denylist.repository';
import { JwtService } from './jwt.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly denylist: DenylistRepository,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) throw new AppError(401, 'Missing bearer token.', { code: 'no-token' });

    let claims;
    try {
      claims = this.jwt.verifyAccess(token);
    } catch {
      throw new AppError(401, 'Invalid or expired token.', { code: 'invalid-token' });
    }

    if (await this.denylist.isDenied(this.db, claims.jti)) {
      throw new AppError(401, 'Token revoked.', { code: 'token-revoked' });
    }

    req.principal = {
      userId: Number(claims.sub),
      role: claims.role,
      jti: claims.jti,
      exp: claims.exp,
      sid: claims.sid,
    };

    return true;
  }
}
