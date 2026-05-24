import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectRow } from './entities/project.entity';

/**
 * All SQL for the `projects` table.
 *
 * Standard reads filter `WHERE deleted_at IS NULL` so soft-deleted projects
 * disappear from normal traffic. Phase 8 will add Admin-only methods
 * (`findDeleted`, `restore`) that explicitly look at deleted rows.
 */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<ProjectRow[]> {
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT id, name, description, owner_id, deleted_at, created_at, updated_at
         FROM projects
        WHERE deleted_at IS NULL
        ORDER BY id ASC`,
    );
    return rows;
  }

  async findById(id: number): Promise<ProjectRow | null> {
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT id, name, description, owner_id, deleted_at, created_at, updated_at
         FROM projects
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async create(input: {
    name: string;
    description?: string;
    ownerId: number;
  }): Promise<ProjectRow> {
    const { rows } = await this.db.query<ProjectRow>(
      `INSERT INTO projects (name, description, owner_id)
            VALUES ($1, $2, $3)
         RETURNING id, name, description, owner_id, deleted_at, created_at, updated_at`,
      [input.name, input.description ?? null, input.ownerId],
    );
    return rows[0];
  }

  /**
   * Dynamic SET clause so we never write columns the client didn't send.
   * Returns the updated row, or null if no active project exists with that id.
   */
  async update(
    id: number,
    input: { name?: string; description?: string },
  ): Promise<ProjectRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${i++}`);
      params.push(input.name);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${i++}`);
      params.push(input.description);
    }
    if (sets.length === 0) return this.findById(id);

    params.push(id);
    const { rows } = await this.db.query<ProjectRow>(
      `UPDATE projects
          SET ${sets.join(', ')}
        WHERE id = $${i} AND deleted_at IS NULL
        RETURNING id, name, description, owner_id, deleted_at, created_at, updated_at`,
      params,
    );
    return rows[0] ?? null;
  }

  /**
   * Soft-delete: sets deleted_at = NOW() on an active row. Returns true if
   * a row was affected (i.e. it existed and wasn't already deleted).
   */
  async softDelete(id: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE projects
          SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ---------------------------------------------------------------------------
  // Phase 8: soft-delete management (ADMIN-only)
  // ---------------------------------------------------------------------------

  /**
   * List only the soft-deleted projects (the inverse of `findAll`'s filter).
   */
  async findDeleted(): Promise<ProjectRow[]> {
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT id, name, description, owner_id, deleted_at, created_at, updated_at
         FROM projects
        WHERE deleted_at IS NOT NULL
        ORDER BY id ASC`,
    );
    return rows;
  }

  /**
   * Fetch a project by id REGARDLESS of deletion state. Used by restore so
   * the service can give a clean 404 vs. "already active" message.
   */
  async findByIdAnyState(id: number): Promise<ProjectRow | null> {
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT id, name, description, owner_id, deleted_at, created_at, updated_at
         FROM projects
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Restore a soft-deleted project: clears deleted_at. Returns true only if
   * a row that WAS deleted got restored — restoring an already-active
   * project affects zero rows.
   */
  async restore(id: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE projects
          SET deleted_at = NULL
        WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
