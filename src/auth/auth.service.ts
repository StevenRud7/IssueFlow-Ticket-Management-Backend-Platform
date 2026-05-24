import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser, JwtPayload, LoginResponse } from './auth.types';
import { TokenDenylistRepository } from './token-denylist.repository';

/**
 * Authentication business logic (§2.2).
 *
 * - validateCredentials() does the bcrypt compare. Returns the bare payload
 *   data the JWT will carry; throws UnauthorizedException on any failure
 *   (missing user OR wrong password — same exception either way, so we
 *   don't reveal whether the username exists).
 *
 * - login() generates a UUIDv4 `jti`, signs the JWT, and returns the
 *   README-contract response shape.
 *
 * - logout() inserts the current token's jti into the deny-list, with the
 *   token's natural expiry as the revoke deadline. Subsequent requests with
 *   the same token will be rejected by JwtStrategy.
 *
 * The token's `expiresIn` claim is taken from JWT_EXPIRES_IN. For
 * predictable behaviour we normalise it to seconds when returning to the
 * client (matches the README's `"expiresIn": 3600` number).
 */
@Injectable()
export class AuthService {
  private readonly expiresInSeconds: number;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly denylist: TokenDenylistRepository,
  ) {
    // JWT_EXPIRES_IN may be "3600", "1h", "30m", etc. We always return
    // seconds in the response, so parse common forms here. Anything we
    // can't parse falls back to one hour.
    this.expiresInSeconds = AuthService.parseExpiresIn(
      this.config.get<string>('JWT_EXPIRES_IN') ?? '3600',
    );
  }

  /**
   * Look up the user, bcrypt-compare the password. Returns the data we'll
   * embed in the JWT; never returns the password hash.
   *
   * Uses UsersService.findRawByUsername which is the internal-only method
   * that returns password_hash (vs. the public findById which strips it).
   */
  private async validateCredentials(
    username: string,
    password: string,
  ): Promise<{
    id: number;
    username: string;
    role: AuthenticatedUser['role'];
  }> {
    const user = await this.users.findRawByUsername(username);
    // Even when no user matches, do a bcrypt compare against a dummy hash so
    // attackers can't tell "user doesn't exist" from "user exists, wrong pw"
    // by timing. We then unconditionally throw if either branch failed.
    const hashToCheck =
      user?.password_hash ??
      // pre-computed valid bcrypt hash; the value doesn't matter.
      '$2a$10$CwTycUXWue0Thq9StjUM0uJ8H6r3wTzjK/Lr9TPsTjErP9SJ73o3.';
    const ok = await bcrypt.compare(password, hashToCheck);
    if (!user || !ok) {
      throw new UnauthorizedException('Invalid username or password');
    }
    return { id: Number(user.id), username: user.username, role: user.role };
  }

  /**
   * Validate credentials and return the signed JWT envelope.
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const validated = await this.validateCredentials(username, password);
    const jti = uuidv4();
    const payload: JwtPayload = {
      sub: validated.id,
      username: validated.username,
      role: validated.role,
      jti,
    };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.expiresInSeconds,
    };
  }

  /**
   * Revoke the current token. `jti` and `exp` come from the JwtStrategy via
   * @CurrentUser — we never trust the client to supply them.
   *
   * `exp` arrives as a unix-epoch in seconds (per the JWT spec); convert to
   * a Date for the timestamptz column.
   */
  async logout(userId: number, jti: string, exp: number): Promise<void> {
    const expiresAt = new Date(exp * 1000);
    await this.denylist.revoke(jti, userId, expiresAt);
  }

  /**
   * Parses common JWT_EXPIRES_IN formats to a positive integer of seconds.
   * Supported forms: "3600" | "60s" | "30m" | "1h" | "7d".
   */
  private static parseExpiresIn(raw: string): number {
    const trimmed = raw.trim();
    // Bare integer => already seconds.
    if (/^\d+$/.test(trimmed)) return Number(trimmed);

    const match = /^(\d+)\s*([smhd])$/i.exec(trimmed);
    if (!match) return 3600;
    const value = Number(match[1]);
    switch (match[2].toLowerCase()) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86_400;
      default:
        return 3600;
    }
  }
}
