import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';

import type { Request, Response } from 'express';

import { AppError, buildProblem, ProblemErrorItem } from './problem';

interface EovLikeError {
  status?: number;
  message?: string;
  errors?: Array<{ path?: string; message?: string; errorCode?: string }>;
}

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const instance = req.originalUrl || req.url || '';

    if (exception instanceof AppError) {
      this.send(res, buildProblem({
        status: exception.status,
        detail: exception.message,
        instance,
        code: exception.code,
        errors: exception.errors,
      }));

      return;
    }

    const eov = exception as EovLikeError;

    if (eov && typeof eov.status === 'number' && typeof eov.message === 'string') {
      const errors: ProblemErrorItem[] | undefined = Array.isArray(eov.errors)
        ? eov.errors.map((e) => ({ path: e.path ?? '', message: e.message ?? '', errorCode: e.errorCode ?? '' }))
        : undefined;

      this.send(res, buildProblem({
        status: eov.status,
        detail: eov.message,
        instance,
        errors,
      }));

      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    this.send(res, buildProblem({ status: 500, detail: 'Internal server error', instance }));
  }

  private send(res: Response, problem: ReturnType<typeof buildProblem>): void {
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
