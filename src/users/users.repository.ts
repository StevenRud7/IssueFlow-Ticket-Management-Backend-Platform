import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UserRow } from './entities/user.entity';
import { UserRole } from './entities/user-role.enum';

/**
 * All SQL for the `users` table. Pure data access — no business rules, no
 * password hashing, no audit-log calls. Service layer composes these methods
 * to implement the actual user features.
 *
 * Every method is a single parameterised `db.query(...)` against the global
 * connection pool. Multi-statement writes would go through `db.transaction()`
 * but users don't need any (Phase 5+ will).
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<UserRow[]> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, username, email, full_name, role, password_hash,
              created_at, updated_at
         FROM users
        ORDER BY id ASC`,
    );
    return rows;
  }

  async findById(id: number): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, username, email, full_name, role, password_hash,
              created_at, updated_at
         FROM users
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Used by Phase 3's AuthService. Case-insensitive because the unique index
   * is on LOWER(username), so "JDoe" should resolve to the row for "jdoe".
   */
  async findByUsername(username: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, username, email, full_name, role, password_hash,
              created_at, updated_at
         FROM users
        WHERE LOWER(username) = LOWER($1)`,
      [username],
    );
    return rows[0] ?? null;
  }

  /**
   * Phase 5 needs this for @mention resolution. Same case-insensitivity as
   * findByUsername, plus we accept a list to resolve every mention in one
   * query rather than N+1.
   */
  async findByUsernamesLower(usernames: string[]): Promise<UserRow[]> {
    if (usernames.length === 0) return [];
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, username, email, full_name, role, password_hash,
              created_at, updated_at
         FROM users
        WHERE LOWER(username) = ANY($1::text[])`,
      [usernames.map((u) => u.toLowerCase())],
    );
    return rows;
  }

  async create(input: {
    username: string;
    email: string;
    fullName: string;
    role: UserRole;
    passwordHash: string | null;
  }): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (username, email, full_name, role, password_hash)
            VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, email, full_name, role, password_hash,
                   created_at, updated_at`,
      [
        input.username,
        input.email,
        input.fullName,
        input.role,
        input.passwordHash,
      ],
    );
    return rows[0];
  }

  /**
   * Dynamic SET clause so we don't bump fields the client didn't send.
   * Returns the updated row, or null if no user with that id exists.
   */
  async update(
    id: number,
    input: { fullName?: string; role?: UserRole },
  ): Promise<UserRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (input.fullName !== undefined) {
      sets.push(`full_name = $${i++}`);
      params.push(input.fullName);
    }
    if (input.role !== undefined) {
      sets.push(`role = $${i++}`);
      params.push(input.role);
    }

    // Defensive: caller is supposed to check for at least one field, but
    // make this a no-op rather than building invalid SQL.
    if (sets.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    const { rows } = await this.db.query<UserRow>(
      `UPDATE users
          SET ${sets.join(', ')}
        WHERE id = $${i}
        RETURNING id, username, email, full_name, role, password_hash,
                  created_at, updated_at`,
      params,
    );
    return rows[0] ?? null;
  }

  /**
   * Hard delete. The PDF doesn't require soft-delete for users (only tickets
   * & projects, §3.5), so this is a real DELETE. The FK constraints from
   * projects.owner_id, comments.author_id, attachments.uploader_id (all
   * ON DELETE RESTRICT) will block deletion if the user still owns
   * referenced rows — which is the right behavior; the service translates
   * the resulting 23503 into a 409 with a helpful message.
   */
  async delete(id: number): Promise<boolean> {
    const result = await this.db.query(`DELETE FROM users WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}