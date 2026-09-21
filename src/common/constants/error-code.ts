import { HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes returned in the `code` field of the
 * error envelope. Clients should branch on these, never on `message`.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // --- Authentication (401) ---
  /** Wrong email or wrong password. Deliberately indistinguishable. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** Malformed, unsigned, or otherwise unusable token. */
  INVALID_TOKEN: 'INVALID_TOKEN',
  /** Well-formed token past its `exp`. Clients should refresh, not re-login. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** An already-rotated refresh token was replayed; the family was revoked. */
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',

  // --- Authorization (403) ---
  /** Authenticated, but missing a required permission. */
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  /** Credential is valid, account is not. 403 (not 401) so clients do not
   *  try to refresh and end up in a logout loop. */
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',

  // --- Registration (409) ---
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.UNPROCESSABLE_ENTITY,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

export function errorCodeForStatus(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR;
}
