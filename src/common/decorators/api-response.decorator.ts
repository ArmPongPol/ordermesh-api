import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrorResponseDto, ApiResponseDto } from '../dto/api-response.dto';
import { PaginatedDto } from '../dto/paginated.dto';

type Options = Omit<ApiResponseOptions, 'schema' | 'type'> & {
  status?: number;
};

/**
 * Documents a route as returning `ApiResponseDto<Model>` — the shape the
 * global `TransformResponseInterceptor` actually produces. Without this the
 * generated OpenAPI describes the bare model and lies to clients.
 */
export const ApiEnvelopeResponse = <TModel extends Type<unknown>>(
  model: TModel,
  options: Options = {},
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiResponse({
      status: 200,
      ...options,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          { properties: { data: { $ref: getSchemaPath(model) } } },
        ],
      },
    }),
  );

/** Same as {@link ApiEnvelopeResponse} but for `data: Model[]`. */
export const ApiEnvelopeArrayResponse = <TModel extends Type<unknown>>(
  model: TModel,
  options: Options = {},
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiResponse({
      status: 200,
      ...options,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );

/** `ApiResponseDto<PaginatedDto<Model>>`. */
export const ApiEnvelopePaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
  options: Options = {},
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, PaginatedDto, model),
    ApiResponse({
      status: 200,
      ...options,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          {
            properties: {
              data: {
                allOf: [
                  { $ref: getSchemaPath(PaginatedDto) },
                  {
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: getSchemaPath(model) },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );

/** Documents the error envelope for one or more status codes. */
export const ApiEnvelopeErrorResponse = (
  status: number,
  description?: string,
) =>
  applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiResponse({
      status,
      description,
      schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
    }),
  );
