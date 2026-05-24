import { IsString, MinLength } from 'class-validator';

/**
 * Input for POST /auth/login.
 *
 * Validation is intentionally minimal here — we only need to ensure the
 * fields are present strings. The real check is bcrypt.compare against the
 * stored hash in AuthService. We never tell the client *which* of username
 * or password was wrong (that's an information-leak), so we don't bother
 * with length/format constraints on login (those belong on user creation).
 */
export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
