import { ApiProperty } from '@nestjs/swagger';

/**
 * The envelope every endpoint returns.
 *
 * Success responses are produced by `TransformResponseInterceptor`,
 * error responses by `HttpExceptionFilter`. Routes annotated with
 * `@SkipTransform()` bypass the envelope entirely.
 */
export class ApiResponseDto<T = unknown> {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 200, description: 'Mirrors the HTTP status code' })
  status: number;

  @ApiProperty({ example: 'Success' })
  message: string;

  @ApiProperty({ nullable: true })
  data: T | null;
}

export class ApiErrorResponseDto extends ApiResponseDto<null> {
  @ApiProperty({ example: false })
  declare success: boolean;

  @ApiProperty({ nullable: true, example: null })
  declare data: null;

  @ApiProperty({
    example: 'VALIDATION_ERROR',
    description: 'Stable machine-readable error code',
  })
  code: string;

  @ApiProperty({
    required: false,
    description: 'Per-field validation messages, present on VALIDATION_ERROR',
    example: { email: ['email must be an email'] },
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  errors?: Record<string, string[]>;

  @ApiProperty({ example: '2026-09-07T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/orders' })
  path: string;

  @ApiProperty({
    example: '2f1c0b4e-4f2a-4c2e-9a1e-6f2b1c0d3e4f',
    description: 'Correlates with the x-request-id response header',
  })
  requestId: string;

  @ApiProperty({
    required: false,
    description:
      'Extra context (e.g. Terminus health details). Non-production only for 5xx.',
  })
  details?: unknown;
}
