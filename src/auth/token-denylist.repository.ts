import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Tiny repository over the `token_denylist` table (defined in 001_init.sql).
 *
 * Used for two operations:
 *   - revoke(jti, userId, expiresAt)  — called on POST /auth/logout
 *   - isRevoked(jti)                   — called by JwtStrategy on EVERY request
 *
 * `isRevoked` deliberately ignores rows whose expiry has passed; once a token
 * would have expired naturally, there's no point in checking the deny-list.
 * Combined with a (not-in-scope) nightly prune, this keeps the table bounded.
 */
@Injectable()
export class TokenDenylistRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Insert the jti into the deny-list. ON CONFLICT DO NOTHING because calling
   * /auth/logout twice with the same token (e.g. retries) should be idempotent
   * rather than 409.
   */
  async revoke(jti: string, userId: number, expiresAt: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO token_denylist (jti, user_id, expires_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (jti) DO NOTHING`,
      [jti, userId, expiresAt],
    );
  }

  async isRevoked(jti: string): Promise<boolean> {
    const { rows } = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS(
          SELECT 1 FROM token_denylist
           WHERE jti = $1 AND expires_at > NOW()
       ) AS exists`,
      [jti],
    );
    return rows[0]?.exists === true;
  }
}
