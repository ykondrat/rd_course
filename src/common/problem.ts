export const PROBLEM_BASE = 'https://api.marketplace.example/problems';

export const TITLES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

export interface ProblemErrorItem {
  path: string;
  message: string;
  errorCode: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code?: string;
  errors?: ProblemErrorItem[];
}

export function buildProblem(args: {
  status: number;
  detail: string;
  instance: string;
  code?: string;
  errors?: ProblemErrorItem[];
}): Problem {
  const { status, detail, instance, code, errors } = args;

  return {
    type: `${PROBLEM_BASE}/${code ?? status}`,
    title: TITLES[status] ?? 'Error',
    status,
    detail,
    instance,
    ...(code ? { code } : {}),
    ...(errors && errors.length ? { errors } : {}),
  };
}

export class AppError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly errors?: ProblemErrorItem[];

  constructor(status: number, detail: string, opts?: { code?: string; errors?: ProblemErrorItem[] }) {
    super(detail);

    this.name = 'AppError';
    this.status = status;
    this.code = opts?.code;
    this.errors = opts?.errors;
  }
}
