// Standard error codes — INTERFACE_CONTRACT v1.1 §1. One AppError type; the Fastify error
// handler maps `.code` -> HTTP status. Codes are the contract's, not ad-hoc strings.
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENT_REPLAY'
  | 'BRANCH_SCOPE_DENIED'
  | 'STATE_TRANSITION_INVALID'
  | 'BATCH_REJECTED_SCHEMA';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENT_REPLAY: 200, // returned as a success envelope, not thrown
  BRANCH_SCOPE_DENIED: 403,
  STATE_TRANSITION_INVALID: 409,
  BATCH_REJECTED_SCHEMA: 409,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const httpStatusFor = (code: ErrorCode) => STATUS[code];
