import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Optional pagination query params. Used by GET /users/:userId/mentions.
 *
 * Defaults: page=1, pageSize=20. pageSize capped at 100 so a client can't
 * accidentally request the entire mention history in one call.
 *
 * @Type(() => Number) is required because query params arrive as strings
 * (the global ValidationPipe's transform coerces them only when the
 * decorator says so).
 */
export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
