import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

/**
 * Input for POST /users.
 *
 * Per the README "Create a user" contract, the request body is
 * { username, email, fullName, role } and returns 200 OK — there is NO
 * password field in the documented contract.
 *
 * `password` is therefore OPTIONAL here. The PDF (§2.2) still requires
 * login by username + password, so we accept a password when the client
 * chooses to send one (it is hashed and stored); when omitted, the user
 * is created exactly as the README specifies and simply has no password
 * until one is set, meaning they cannot log in yet. Following the README
 * as the implementation contract takes precedence over inventing a
 * required field it does not list.
 *
 * Username is restricted to alphanumeric + underscore so the @mention
 * regex (/@([a-zA-Z0-9_]+)/) can reliably terminate at word boundaries.
 */
export class CreateUserDto {
  @IsString()
  @Length(3, 64)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username must contain only letters, digits, and underscores',
  })
  username!: string;

  @IsEmail()
  @Length(1, 255)
  email!: string;

  @IsString()
  @Length(1, 255)
  fullName!: string;

  @IsEnum(UserRole, {
    message: `role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role!: UserRole;

  /**
   * Optional. If provided it must be at least 8 characters; if omitted the
   * user is created without a password (and cannot log in until one is set).
   */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password?: string;
}