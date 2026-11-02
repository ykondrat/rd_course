import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface Principal {
  userId: number;
  role: string;
  jti: string;
  exp: number;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<Request & { principal: Principal }>();

  return req.principal;
});