import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './http-exception.filter';
import { ErrorCode } from '../constants/error-code';
import { ApiErrorResponseDto } from '../dto/api-response.dto';

const REQUEST_ID = '11111111-2222-3333-4444-555555555555';

function makeHost(overrides: Partial<{ requestId: string; url: string }> = {}) {
  const json = jest.fn<void, [ApiErrorResponseDto]>();
  const status = jest.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        method: 'POST',
        originalUrl: overrides.url ?? '/api/v1/orders',
        headers: {
          'x-request-id':
            overrides.requestId === undefined
              ? REQUEST_ID
              : overrides.requestId,
        },
      }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

function makeFilter(env: 'development' | 'production' = 'development') {
  const config = {
    get: jest.fn().mockReturnValue(env),
  } as unknown as ConfigService;
  return new HttpExceptionFilter(config);
}

describe('HttpExceptionFilter', () => {
  beforeAll(() => {
    // The filter logs 5xx with a stack; keep test output readable.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  it('maps a NotFoundException to the error envelope with a NOT_FOUND code', () => {
    const { host, status, json } = makeHost();
    makeFilter().catch(new NotFoundException('Order not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        status: 404,
        message: 'Order not found',
        data: null,
        code: ErrorCode.NOT_FOUND,
        path: '/api/v1/orders',
        requestId: REQUEST_ID,
      }),
    );
    expect(json.mock.calls[0][0].timestamp).toEqual(expect.any(String));
  });

  // Regression: validation messages used to be flattened with .join(', '),
  // leaving the client unable to bind errors to form fields.
  it('groups ValidationPipe messages per field instead of joining them', () => {
    const { host, json } = makeHost();
    makeFilter().catch(
      new BadRequestException({
        statusCode: 400,
        message: [
          'email must be an email',
          'email should not be empty',
          'age must be an integer number',
        ],
        error: 'Bad Request',
      }),
      host,
    );

    const body = json.mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.message).toBe('Validation failed');
    expect(body.errors).toEqual({
      email: ['email must be an email', 'email should not be empty'],
      age: ['age must be an integer number'],
    });
  });

  // Regression: Terminus responses have no `message` key, so the filter used to
  // report "Internal server error" and drop every indicator detail. The health
  // document is now passed through so /health looks the same pass or fail.
  it('passes a failing Terminus health document through untouched', () => {
    const { host, status, json } = makeHost({ url: '/health' });
    const terminusPayload = {
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    };

    makeFilter().catch(new ServiceUnavailableException(terminusPayload), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith(terminusPayload);
  });

  it('still enveloped a 503 that is not a health document', () => {
    const { host, json } = makeHost();
    makeFilter().catch(new ServiceUnavailableException('Upstream down'), host);

    const body = json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(body.message).toBe('Upstream down');
  });

  it('masks non-HttpException errors and exposes no stack', () => {
    const { host, status, json } = makeHost();
    makeFilter('production').catch(
      new Error('connect ECONNREFUSED 10.0.0.5:5432'),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('includes a debug detail for unexpected errors outside production', () => {
    const { host, json } = makeHost();
    makeFilter('development').catch(new Error('boom'), host);

    expect(json.mock.calls[0][0].details).toEqual({
      name: 'Error',
      message: 'boom',
    });
  });

  it('falls back to an empty requestId when the header is missing', () => {
    const { host, json } = makeHost({ requestId: '' });
    makeFilter().catch(new HttpException('nope', HttpStatus.CONFLICT), host);

    const body = json.mock.calls[0][0];
    expect(body.requestId).toBe('');
    expect(body.code).toBe(ErrorCode.CONFLICT);
  });
});
