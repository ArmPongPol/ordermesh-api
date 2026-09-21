import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { ErrorCode } from '../constants/error-code';
import { ApiErrorResponseDto } from '../dto/api-response.dto';
import {
  AppHttpException,
  accountNotActive,
  emailAlreadyExists,
  insufficientPermissions,
  invalidCredentials,
  invalidToken,
  tokenExpired,
  tokenReuseDetected,
} from './app.exception';

const REQUEST_ID = '11111111-2222-3333-4444-555555555555';

/**
 * These exceptions are only correct insofar as the real filter turns them into
 * the right envelope, so every case here runs through `HttpExceptionFilter`
 * rather than asserting on `getResponse()`. That makes this spec the contract:
 * a future filter refactor that stops reading `code` fails here.
 */
function emit(exception: unknown): ApiErrorResponseDto {
  const json = jest.fn<void, [ApiErrorResponseDto]>();
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: jest.fn().mockReturnValue({ json }) }),
      getRequest: () => ({
        method: 'POST',
        originalUrl: '/api/v1/auth/login',
        headers: { 'x-request-id': REQUEST_ID },
      }),
    }),
  } as unknown as ArgumentsHost;

  const config = {
    get: jest.fn().mockReturnValue('development'),
  } as unknown as ConfigService;

  new HttpExceptionFilter(config).catch(exception, host);
  return json.mock.calls[0][0];
}

describe('AppHttpException', () => {
  it.each([
    [invalidCredentials(), 401, ErrorCode.INVALID_CREDENTIALS],
    [invalidToken(), 401, ErrorCode.INVALID_TOKEN],
    [tokenExpired(), 401, ErrorCode.TOKEN_EXPIRED],
    [tokenReuseDetected(), 401, ErrorCode.TOKEN_REUSE_DETECTED],
    [
      insufficientPermissions(['order:update']),
      403,
      ErrorCode.INSUFFICIENT_PERMISSIONS,
    ],
    [accountNotActive('SUSPENDED'), 403, ErrorCode.ACCOUNT_SUSPENDED],
    [accountNotActive('INACTIVE'), 403, ErrorCode.ACCOUNT_INACTIVE],
    [emailAlreadyExists(), 409, ErrorCode.EMAIL_ALREADY_EXISTS],
  ])('carries its own code through the filter', (exception, status, code) => {
    const body = emit(exception);

    expect(body.success).toBe(false);
    expect(body.status).toBe(status);
    expect(body.code).toBe(code);
    expect(body.message).toEqual(expect.any(String));
    expect(body.data).toBeNull();
    expect(body.requestId).toBe(REQUEST_ID);
    // `details` is only populated for non-HttpException 5xx; nothing in these
    // factories may rely on it.
    expect(body.details).toBeUndefined();
  });

  // The whole point of the domain code: without it the filter would derive a
  // generic UNAUTHORIZED from the 401 and clients could not tell the cases apart.
  it('overrides the status-derived code rather than falling back to it', () => {
    expect(emit(invalidCredentials()).code).not.toBe(ErrorCode.UNAUTHORIZED);
    expect(emit(accountNotActive('SUSPENDED')).code).not.toBe(
      ErrorCode.FORBIDDEN,
    );
  });

  // An expired token must be distinguishable so the client refreshes instead of
  // bouncing the user to the login screen.
  it('distinguishes an expired token from an invalid one', () => {
    expect(emit(tokenExpired()).code).toBe(ErrorCode.TOKEN_EXPIRED);
    expect(emit(invalidToken()).code).toBe(ErrorCode.INVALID_TOKEN);
  });

  it('never reveals whether the email or the password was wrong', () => {
    const body = emit(invalidCredentials());

    expect(body.message).toBe('Invalid email or password');
    // Nothing anywhere in the envelope may hint that the account was the problem.
    expect(JSON.stringify(body)).not.toMatch(
      /not found|no such|unknown user|does not exist|wrong password/i,
    );
  });

  it('names the missing permission so a 403 is actionable', () => {
    expect(emit(insufficientPermissions(['stock:adjust'])).message).toContain(
      'stock:adjust',
    );
  });

  it('keeps message a string, never an array', () => {
    // An array message is interpreted as ValidationPipe output and rewrites the
    // code to VALIDATION_ERROR, silently destroying the domain code.
    const exception = new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'taken',
    );
    const response = exception.getResponse() as { message: unknown };

    expect(typeof response.message).toBe('string');
    expect(emit(exception).code).toBe(ErrorCode.EMAIL_ALREADY_EXISTS);
  });
});
