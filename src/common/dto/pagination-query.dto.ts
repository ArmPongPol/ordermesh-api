import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Shared query contract for every list endpoint. Extend it per resource to add
 * filters; the global ValidationPipe runs with `forbidNonWhitelisted: true`,
 * so any unknown query parameter is rejected with 400.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Property name to sort by' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: SortDirection, default: SortDirection.DESC })
  @IsOptional()
  @IsEnum(SortDirection)
  sortDirection: SortDirection = SortDirection.DESC;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
