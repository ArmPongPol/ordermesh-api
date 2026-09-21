import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-code';

/**
 * An HttpException that carries a domain-specific {@link ErrorCode}.
 *
 * `HttpExceptionFilter` reads `code` off the exception response and lets it
 * override the status-derived default, so the envelope reports
 * `INVALID_CREDENTIALS` rather than the generic `UNAUTHORIZED`.
 *
 * Two constraints the filter imposes, and the reason this class exists rather
 * than callers hand-rolling the object literal:
 *
 *  - `message` must be a **string**. The filter treats an array as
 *    ValidationPipe output and rewrites `code` to `VALIDATION_ERROR`.
 *  - `details` is ignored for 4xx (it is only populated for non-HttpException
 *    5xx), so nothing load-bearing may be put there.
 */
export class AppHttpException extends HttpException {
  // `status` is deliberately a plain parameter: HttpException already declares
  // a private field of that name, so redeclaring it here is a type error.
  // Callers read the status via the inherited `getStatus()`.
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
  ) {
    super({ statusCode: status, message, code }, status);
  }
}

/**
 * Unknown email and wrong password MUST produce this same exception — same
 * status, same code, same message. Anything else turns login into an oracle
 * for which email addresses are registered.
 */
export const invalidCredentials = () =>
  new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid email or password',
  );

export const invalidToken = (message = 'Invalid token') =>
  new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_TOKEN,
    message,
  );

/** Distinct from INVALID_TOKEN so clients know to refresh rather than re-login. */
export const tokenExpired = (message = 'Token has expired') =>
  new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.TOKEN_EXPIRED,
    message,
  );

export const tokenReuseDetected = () =>
  new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.TOKEN_REUSE_DETECTED,
    'Refresh token has already been used; all sessions have been revoked',
  );

/**
 * Names the missing permission. Safe to disclose: it describes the caller's own
 * grants, not whether any particular record exists.
 */
export const insufficientPermissions = (missing: readonly string[]) =>
  new AppHttpException(
    HttpStatus.FORBIDDEN,
    ErrorCode.INSUFFICIENT_PERMISSIONS,
    `Missing required permission: ${missing.join(', ')}`,
  );

/**
 * 403, not 401 — the credential is valid, the account is not. A 401 would make
 * clients attempt a refresh, which also fails, producing a logout loop.
 */
export const accountNotActive = (status: 'INACTIVE' | 'SUSPENDED') =>
  status === 'SUSPENDED'
    ? new AppHttpException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_SUSPENDED,
        'This account has been suspended',
      )
    : new AppHttpException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_INACTIVE,
        'This account is not active',
      );

export const emailAlreadyExists = () =>
  new AppHttpException(
    HttpStatus.CONFLICT,
    ErrorCode.EMAIL_ALREADY_EXISTS,
    'An account with this email already exists',
  );
