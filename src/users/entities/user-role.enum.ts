/**
 * Mirrors the `user_role` enum in 001_init.sql. Kept in sync manually — if
 * either side changes, both must change. Postgres rejects any string outside
 * this set at insert time, and `class-validator`'s @IsEnum rejects it at the
 * API boundary.
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  DEVELOPER = 'DEVELOPER',
}
