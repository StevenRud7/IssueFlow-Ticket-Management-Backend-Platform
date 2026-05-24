import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuditAction } from './entities/audit-action.enum';
import { AuditActor } from './entities/audit-actor.enum';
import { AuditEntity } from './entities/audit-entity.enum';
import { AuditLogRow } from './entities/audit-log.entity';

/**
 * Input for inserting an audit row. `metadata` is optional and freeform —
 * services use it for context like before/after diffs on updates.
 */
export interface AuditInsert {
  action: AuditAction;
  entityType: AuditEntity;
  entityId: number;
  performedBy: number | null;
  actor: AuditActor;
  metadata?: Record<string, unknown>;
}

/**
 * SQL for the `audit_logs` table.
 *
 * Two surfaces:
 *   - `insert()` and `insertWithClient()` for emitting an entry. The
 *     second variant accepts a pg PoolClient so the audit write can
 *     participate in the caller's transaction (used by Phase 5 Comments
 *     and forward).
 *
 *   - `find()` for the GET endpoint, with optional filters AND'd
 *     together. Pagination via LIMIT/OFFSET plus a COUNT for total.
 *
 * Filters use a dynamic WHERE clause built from supplied params, keeping
 * all values parameter-bound — never string-concatenated.
 */
@Injectable()
export class AuditRepository {
  private static readonly COLUMNS = `
    id, action, entity_type, entity_id, performed_by, actor, metadata, timestamp
  `;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Stand-alone insert via the pool. Use this when the caller is not
   * inside an existing transaction.
   */
  async insert(input: AuditInsert): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs
              (action, entity_type, entity_id, performed_by, actor, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.action,
        input.entityType,
        input.entityId,
        input.performedBy,
        input.actor,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  /**
   * Insert using an existing transaction's client, so the audit row commits
   * atomically with whatever business write triggered it. If the outer
   * transaction rolls back, so does the audit entry — exactly what we want.
   */
  async insertWithClient(
    client: PoolClient,
    input: AuditInsert,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
              (action, entity_type, entity_id, performed_by, actor, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.action,
        input.entityType,
        input.entityId,
        input.performedBy,
        input.actor,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  /**
   * Paginated, filtered find. Filters are AND'd; absent filters don't
   * appear in the WHERE clause. Newest first.
   */
  async find(filters: {
    entityType?: AuditEntity;
    entityId?: number;
    action?: AuditAction;
    actor?: AuditActor;
  }): Promise<AuditLogRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters.entityType !== undefined) {
      where.push(`entity_type = $${i++}`);
      params.push(filters.entityType);
    }
    if (filters.entityId !== undefined) {
      where.push(`entity_id = $${i++}`);
      params.push(filters.entityId);
    }
    if (filters.action !== undefined) {
      where.push(`action = $${i++}`);
      params.push(filters.action);
    }
    if (filters.actor !== undefined) {
      where.push(`actor = $${i++}`);
      params.push(filters.actor);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // Newest first. The `id DESC` tiebreaker keeps ordering stable for
    // entries written within the same millisecond.
    const { rows } = await this.db.query<AuditLogRow>(
      `SELECT ${AuditRepository.COLUMNS}
         FROM audit_logs
         ${whereClause}
        ORDER BY timestamp DESC, id DESC`,
      params,
    );
    return rows;
  }
}