import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Input for PATCH /projects/:projectId. Per the README example, only `name`
 * and `description` are updatable through this endpoint. `ownerId` is NOT
 * in this DTO — ownership changes are out of scope for the basic contract.
 *
 * With `forbidNonWhitelisted: true` on the global ValidationPipe, attempting
 * to send `ownerId` here produces a 400.
 *
 * Both fields are optional; the service requires at least one to be present.
 */
export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
