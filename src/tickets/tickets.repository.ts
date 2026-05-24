import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TicketPriority } from './entities/ticket-priority.enum';
import { TicketStatus } from './entities/ticket-status.enum';
import { TicketType } from './entities/ticket-type.enum';
import { TicketRow } from './entities/ticket.entity';

/**
 * SQL for the `tickets` table.
 *
 * The interesting method here is `updateWithVersionCheck` — every UPDATE
 * scopes its WHERE by both id AND version, and bumps version atomically.
 * If two clients PATCH the same ticket with the same starting version, the
 * UPDATE will affect exactly one row; the second client's call returns
 * rowCount=0 and the service maps that to a 409 Conflict.
 *
 * Standard reads filter `WHERE deleted_at IS NULL`. Phase 8 adds the
 * admin endpoints that look at deleted rows.
 */
@Injectable()
export class TicketsRepository {
  /**
   * Selects every column in a stable order. Used by every method below so
   * the row shape is consistent.
   */
  private static readonly COLUMNS = `
    id, title, description, status, priority, type,
    project_id, assignee_id, due_date, is_overdue,
    version, deleted_at, created_at, updated_at
  `;

  constructor(private readonly db: DatabaseService) {}

  async findByProject(projectId: number): Promise<TicketRow[]> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT ${TicketsRepository.COLUMNS}
         FROM tickets
        WHERE project_id = $1 AND deleted_at IS NULL
        ORDER BY id ASC`,
      [projectId],
    );
    return rows;
  }

  async findAll(): Promise<TicketRow[]> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT ${TicketsRepository.COLUMNS}
         FROM tickets
        WHERE deleted_at IS NULL
        ORDER BY id ASC`,
    );
    return rows;
  }

  async findById(id: number): Promise<TicketRow | null> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT ${TicketsRepository.COLUMNS}
         FROM tickets
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async create(input: {
    title: string;
    description?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    type: TicketType;
    projectId: number;
    assigneeId?: number | null;
    dueDate?: string;
  }): Promise<TicketRow> {
    // Build the column list dynamically so we let DB defaults apply for
    // omitted status/priority instead of writing NULL.
    const cols: string[] = ['title', 'description', 'type', 'project_id'];
    const placeholders: string[] = ['$1', '$2', '$3', '$4'];
    const params: unknown[] = [
      input.title,
      input.description ?? null,
      input.type,
      input.projectId,
    ];
    let i = 5;

    if (input.status !== undefined) {
      cols.push('status');
      placeholders.push(`$${i++}`);
      params.push(input.status);
    }
    if (input.priority !== undefined) {
      cols.push('priority');
      placeholders.push(`$${i++}`);
      params.push(input.priority);
    }
    if (input.assigneeId !== undefined) {
      cols.push('assignee_id');
      placeholders.push(`$${i++}`);
      params.push(input.assigneeId);
    }
    if (input.dueDate !== undefined) {
      cols.push('due_date');
      placeholders.push(`$${i++}`);
      params.push(input.dueDate);
    }

    const { rows } = await this.db.query<TicketRow>(
      `INSERT INTO tickets (${cols.join(', ')})
            VALUES (${placeholders.join(', ')})
         RETURNING ${TicketsRepository.COLUMNS}`,
      params,
    );
    return rows[0];
  }

  /**
   * Optimistic-lock UPDATE: scopes by id AND expectedVersion, bumps version
   * by 1. Returns null when:
   *   - no row with that id (already deleted, or never existed), OR
   *   - the row exists but version moved on
   *
   * The service distinguishes these cases by first checking the row exists
   * (which costs one extra SELECT but produces clear error messages).
   *
   * `resetOverdueFlag` is set true when the caller is touching `priority`
   * — §3.7 requires resetting `is_overdue` when priority is manually
   * changed so the next escalation cycle re-evaluates.
   */
  async updateWithVersionCheck(
    id: number,
    expectedVersion: number,
    input: {
      title?: string;
      description?: string;
      status?: TicketStatus;
      priority?: TicketPriority;
      assigneeId?: number;
      dueDate?: string;
    },
    resetOverdueFlag: boolean,
  ): Promise<TicketRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (input.title !== undefined) {
      sets.push(`title = $${i++}`);
      params.push(input.title);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${i++}`);
      params.push(input.description);
    }
    if (input.status !== undefined) {
      sets.push(`status = $${i++}`);
      params.push(input.status);
    }
    if (input.priority !== undefined) {
      sets.push(`priority = $${i++}`);
      params.push(input.priority);
    }
    if (input.assigneeId !== undefined) {
      sets.push(`assignee_id = $${i++}`);
      params.push(input.assigneeId);
    }
    if (input.dueDate !== undefined) {
      sets.push(`due_date = $${i++}`);
      params.push(input.dueDate);
    }
    if (resetOverdueFlag) {
      sets.push(`is_overdue = FALSE`);
    }
    // Always bump version atomically with the same UPDATE.
    sets.push(`version = version + 1`);

    params.push(id);
    const idIdx = i++;
    params.push(expectedVersion);
    const verIdx = i;

    const { rows } = await this.db.query<TicketRow>(
      `UPDATE tickets
          SET ${sets.join(', ')}
        WHERE id = $${idIdx}
          AND version = $${verIdx}
          AND deleted_at IS NULL
        RETURNING ${TicketsRepository.COLUMNS}`,
      params,
    );
    return rows[0] ?? null;
  }

  async softDelete(id: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE tickets
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
   * List only the soft-deleted tickets of one project.
   */
  async findDeletedByProject(projectId: number): Promise<TicketRow[]> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT ${TicketsRepository.COLUMNS}
         FROM tickets
        WHERE project_id = $1 AND deleted_at IS NOT NULL
        ORDER BY id ASC`,
      [projectId],
    );
    return rows;
  }

  /**
   * Fetch a ticket by id REGARDLESS of deletion state. Used by restore.
   */
  async findByIdAnyState(id: number): Promise<TicketRow | null> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT ${TicketsRepository.COLUMNS}
         FROM tickets
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Restore a soft-deleted ticket: clears deleted_at. Returns true only if
   * a row that WAS deleted got restored.
   */
  async restore(id: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE tickets
          SET deleted_at = NULL
        WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Soft-deletes all tickets in a project. Phase 4 doesn't call this — the
   * service deliberately doesn't cascade — but Phase 8 will offer it as an
   * optional admin tool.
   */
  async softDeleteByProject(projectId: number): Promise<number> {
    const result = await this.db.query(
      `UPDATE tickets
          SET deleted_at = NOW()
        WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    return result.rowCount ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Phase 7: workload + auto-assignment + escalation queries
  // ---------------------------------------------------------------------------

  /**
   * Workload of every DEVELOPER, scoped to one project (§3.8).
   *
   * "Workload" = count of non-DONE, non-deleted tickets assigned to that
   * user within the given project. ADMINs are excluded — only DEVELOPERs
   * are auto-assignment candidates.
   *
   * LEFT JOIN so a developer with zero tickets still appears with count 0.
   * Sorted by (count ASC, users.created_at ASC) — that ordering means the
   * first row is exactly the auto-assignment pick: least-loaded, ties
   * broken by registration order (oldest first).
   *
   * The `tickets_workload_idx` partial index (project_id, assignee_id,
   * status) WHERE deleted_at IS NULL backs the COUNT efficiently.
   */
  async workloadByProject(
    projectId: number,
  ): Promise<{ userId: number; username: string; openTicketCount: number }[]> {
    const { rows } = await this.db.query<{
      user_id: number;
      username: string;
      open_ticket_count: string;
    }>(
      `SELECT u.id AS user_id,
              u.username AS username,
              COUNT(t.id) AS open_ticket_count
         FROM users u
         LEFT JOIN tickets t
           ON t.assignee_id = u.id
          AND t.project_id = $1
          AND t.status <> 'DONE'
          AND t.deleted_at IS NULL
        WHERE u.role = 'DEVELOPER'
        GROUP BY u.id, u.username, u.created_at
        ORDER BY COUNT(t.id) ASC, u.created_at ASC`,
      [projectId],
    );
    return rows.map((r) => ({
      userId: Number(r.user_id),
      username: r.username,
      openTicketCount: Number(r.open_ticket_count),
    }));
  }

  /**
   * Every ticket that is currently overdue and unresolved — i.e. has a
   * dueDate in the past, isn't DONE, and isn't soft-deleted. The escalation
   * scheduler reads this set each cycle and promotes priorities.
   *
   * Returns the full TicketRow so the scheduler can decide per-ticket what
   * to do (promote vs. set is_overdue) without a second query.
   */
  async findOverdueUnresolved(): Promise<TicketRow[]> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT ${TicketsRepository.COLUMNS}
         FROM tickets
        WHERE due_date IS NOT NULL
          AND due_date < NOW()
          AND status <> 'DONE'
          AND deleted_at IS NULL
        ORDER BY id ASC`,
    );
    return rows;
  }

  /**
   * Apply one escalation step to a single ticket, by id.
   *
   * Two mutually exclusive cases (the caller decides which):
   *   - promote: set priority to `newPriority` (one level up the ladder)
   *   - mark overdue: set is_overdue = TRUE (ticket is already CRITICAL)
   *
   * Either way `version` is bumped so a concurrent client PATCH sees the
   * change as a version conflict rather than silently losing it.
   *
   * Scoped by `WHERE status <> 'DONE' AND deleted_at IS NULL` so a ticket
   * that was resolved/deleted between the scan and this update is skipped.
   * Returns the updated row, or null if it was skipped.
   */
  async applyEscalation(
    id: number,
    change:
      | { kind: 'promote'; newPriority: TicketPriority }
      | { kind: 'mark_overdue' },
  ): Promise<TicketRow | null> {
    const setClause =
      change.kind === 'promote'
        ? 'priority = $2, version = version + 1'
        : 'is_overdue = TRUE, version = version + 1';
    const params: unknown[] =
      change.kind === 'promote' ? [id, change.newPriority] : [id];

    const { rows } = await this.db.query<TicketRow>(
      `UPDATE tickets
          SET ${setClause}
        WHERE id = $1
          AND status <> 'DONE'
          AND deleted_at IS NULL
        RETURNING ${TicketsRepository.COLUMNS}`,
      params,
    );
    return rows[0] ?? null;
  }
}
