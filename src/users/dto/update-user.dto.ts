import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

/**
 * Input for `POST /users/update/:userId`.
 *
 * Per §2.1: "Update a user's details (full name, role)" — only those two
 * fields are updatable. Username, email, password are intentionally NOT
 * mutable through this endpoint to keep the API contract narrow.
 *
 * Both fields optional; the service requires at least one to be present.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  fullName?: string;

  @IsOptional()
  @IsEnum(UserRole, {
    message: `role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role?: UserRole;
}
