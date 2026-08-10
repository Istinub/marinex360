export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'BRANCH_SCOPE_DENIED'
  | 'STATE_TRANSITION_INVALID'
  | 'BATCH_REJECTED_SCHEMA';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

const apiErrorCodes = new Set<string>([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'IDEMPOTENT_REPLAY',
  'BRANCH_SCOPE_DENIED',
  'STATE_TRANSITION_INVALID',
  'BATCH_REJECTED_SCHEMA',
]);

export class ApiResponseError extends Error implements ApiError {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly status: number;

  constructor(error: ApiError, status: number) {
    super(error.message);
    this.name = 'ApiResponseError';
    this.code = error.code;
    this.details = error.details;
    this.status = status;
  }
}

export function isApiErrorCode(code: string): code is ApiErrorCode {
  return apiErrorCodes.has(code);
}

export function isUnauthorizedError(error: unknown): error is ApiError {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'UNAUTHORIZED';
}

export function parseApiErrorEnvelope(body: unknown): ApiError | null {
  const envelope = body as ErrorEnvelope;
  const code = envelope.error?.code;
  const message = envelope.error?.message;

  if (!code || !isApiErrorCode(code) || !message) return null;

  return {
    code,
    message,
    details: envelope.error?.details,
  };
}
