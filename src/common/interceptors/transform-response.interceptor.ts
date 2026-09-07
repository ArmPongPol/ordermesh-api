import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiResponseDto } from '../dto/api-response.dto';
import { map, Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';

/**
 * A handler may return `{ message, data }` to override the envelope message;
 * anything else becomes `data` verbatim.
 */
interface SuccessPayload<T> {
  message?: string;
  data?: T;
}

@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponseDto<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseDto<T>> | Promise<Observable<ApiResponseDto<T>>> {
    if (context.getType() !== 'http') {
      return next.handle() as unknown as Observable<ApiResponseDto<T>>;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle() as unknown as Observable<ApiResponseDto<T>>;
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((payload: T): ApiResponseDto<T> => {
        const status = response.statusCode;

        if (
          payload !== null &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          ('message' in payload || 'data' in payload)
        ) {
          const value = payload as SuccessPayload<T>;

          return {
            success: true,
            status,
            message: value.message || 'Success',
            // `??` not `||`: 0, '' and false are legitimate payloads.
            data: value.data ?? null,
          };
        }

        return {
          success: true,
          status,
          message: 'Success',
          data: payload ?? null,
        };
      }),
    );
  }
}
