import { UserRole } from '../users/entities/user-role.enum';

/**
 * Shape of `req.user` after JwtAuthGuard has authenticated the request.
 *
 * Returned by JwtStrategy.validate() — Passport then attaches it to the
 * request. The @CurrentUser decorator reads it from there.
 *
 * Intentionally minimal: just enough for handlers to know who's calling
 * (audit logs, ownership checks) and what role they have (RolesGuard).
 * No email/fullName because those would need fresh DB reads.
 *
 *   jti is included because POST /auth/logout needs to write the *current*
 *   token's jti into token_denylist.
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  role: UserRole;
  jti: string;
  exp: number; // unix-epoch seconds; needed to set token_denylist.expires_at
}

/**
 * Shape of the JWT payload we sign and verify.
 *
 *   sub  - subject = user id (numeric)
 *   jti  - unique token id, written to token_denylist on logout
 *   iat  - issued-at, automatically set by @nestjs/jwt
 *   exp  - expiry,    automatically set from JWT_EXPIRES_IN
 */
export interface JwtPayload {
  sub: number;
  username: string;
  role: UserRole;
  jti: string;
  iat?: number;
  exp?: number;
}

/**
 * Shape of POST /auth/login response, matching the README contract:
 *   { "accessToken": "<jwt>", "tokenType": "Bearer", "expiresIn": 3600 }
 */
export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
