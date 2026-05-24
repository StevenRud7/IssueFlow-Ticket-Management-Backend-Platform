import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Reusable DTO for any numeric `:id` path parameter. Use as:
 *
 *   @Get(':userId')
 *   findOne(@Param() params: { userId: number }) { ... }
 *
 * Together with the global ValidationPipe's `transform: true`, this coerces
 * the path string "42" into the number 42 and rejects anything else with 400.
 *
 * We expose a generic shape — actual DTOs for `userId`, `projectId` etc.
 * extend this via `class` syntax so the field name in error messages matches
 * the URL parameter.
 */
export class NumericIdParam {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;
}
