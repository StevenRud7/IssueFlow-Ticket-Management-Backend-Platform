import { UserRole } from './user-role.enum';

/**
 * Shape of a `users` table row as returned by the pg driver. snake_case fields
 * from Postgres are mapped to camelCase here in code (we don't rely on column
 * aliasing in SQL — keeping aliases out of queries makes them easier to read).
 */
export interface UserRow {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: UserRole;
  /**
   * bcrypt hash, or null when the user was created without a password
   * (the README "Create a user" contract has no password field). A user
   * with a null hash cannot authenticate via POST /auth/login.
   */
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Public-facing shape. Never includes passwordHash. Every endpoint that
 * returns a user must go through `toUserResponse()` so we don't accidentally
 * leak the hash.
 */
export interface UserResponse {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export function toUserResponse(row: UserRow): UserResponse {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
  };
}