import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { ApiErrorResponseDto } from '../dto/api-response.dto';
import { ErrorCode, errorCodeForStatus } from '../constants/error-code';

/**
 * ValidationPipe reports failures as `message: string[]`, where each entry is
 * prefixed with the property name (e.g. "email must be an email"). We keep the
 * raw list and additionally group it per field so a client can bind errors to
 * form inputs.
 */
function groupValidationMessages(messages: string[]): Record<string, string[]> {
  return messages.reduce<Record<string, string[]>>((acc, raw) => {
    const field = raw.split(' ')[0] || '_';
    (acc[field] ??= []).push(raw);
    return acc;
  }, {});
}

/**
 * A failing Terminus check throws a ServiceUnavailableException carrying the
 * full health document. Monitoring tools expect that document verbatim, so it
 * is passed through instead of being reshaped into the error envelope - which
 * keeps /health's contract identical whether it passes or fails.
 */
function asTerminusDocument(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  const candidate = payload as Record<string, unknown>;
  const looksLikeTerminus =
    'status' in candidate && 'info' in candidate && 'details' in candidate;

  return looksLikeTerminus ? candidate : undefined;
}

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly config: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const terminusDocument = asTerminusDocument(exceptionResponse);
    if (terminusDocument) {
      response.status(status).json(terminusDocument);
      return;
    }

    const isProduction = this.config.get<string>('app.env') === 'production';

    let message = 'Internal server error';
    let code: string = errorCodeForStatus(status);
    let errors: Record<string, string[]> | undefined;
    let details: unknown;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      !Array.isArray(exceptionResponse)
    ) {
      const typed = exceptionResponse as {
        message?: string | string[];
        code?: string;
        error?: string;
      };

      if (Array.isArray(typed.message)) {
        // ValidationPipe output.
        message = 'Validation failed';
        code = ErrorCode.VALIDATION_ERROR;
        errors = groupValidationMessages(typed.message);
      } else if (typed.message) {
        message = typed.message;
      } else if (typed.error) {
        message = typed.error;
      }

      // A custom exception may carry its own domain-specific code.
      if (typeof typed.code === 'string') {
        code = typed.code;
      }
    }

    const rawId = request.headers['x-request-id'];
    const requestId = (Array.isArray(rawId) ? rawId[0] : rawId) || '';

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed with ${status} requestId=${requestId || '-'}`,
        exception instanceof Error ? exception.stack : undefined,
      );

      // Never leak internal failure text or stacks to clients.
      if (!(exception instanceof HttpException)) {
        message = 'Internal server error';
        code = ErrorCode.INTERNAL_ERROR;
        details =
          isProduction || !(exception instanceof Error)
            ? undefined
            : { name: exception.name, message: exception.message };
      }
    }

    const body: ApiErrorResponseDto = {
      success: false,
      status,
      message,
      data: null,
      code,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      requestId,
    };

    if (errors) {
      body.errors = errors;
    }
    if (details !== undefined) {
      body.details = details;
    }

    response.status(status).json(body);
  }
}
