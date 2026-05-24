import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Input for POST /projects. Matches the README contract exactly:
 *   { "name": "...", "description": "...", "ownerId": 1 }
 *
 * Description is optional — the schema allows NULL — but if present must
 * be a string. ownerId is required; the service validates that the user
 * actually exists before insert, producing a friendly 400 rather than the
 * raw FK violation that the DB would emit.
 */
export class CreateProjectDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ownerId!: number;
}
