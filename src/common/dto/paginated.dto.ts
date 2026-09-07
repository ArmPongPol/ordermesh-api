import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 137 })
  total: number;

  @ApiProperty({ example: 7 })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNext: boolean;

  @ApiProperty({ example: false })
  hasPrevious: boolean;
}

/**
 * Standard list payload. Sits inside `ApiResponseDto.data`, so a paginated
 * endpoint returns `{ success, status, message, data: { items, meta } }`.
 */
export class PaginatedDto<T = unknown> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedDto<T> {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
  };
}
