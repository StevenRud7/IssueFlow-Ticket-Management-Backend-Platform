import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TicketStatus } from './entities/ticket-status.enum';

/**
 * One row of the "blockers" list returned by GET /tickets/:id/dependencies.
 * Shape matches the README contract: { id, title, status }.
 */
export interface BlockerRow {
  id: number;
  title: string;
  status: TicketStatus;
}

/**
 * SQL for the `ticket_dependencies` table.
 *
 * Semantics: a row (ticket_id, blocker_id) means "ticket_id is blocked by
 * blocker_id". The table-level PRIMARY KEY (ticket_id, blocker_id) makes
 * duplicate dependencies impossible, and the CHECK (ticket_id <> blocker_id)
 * blocks self-dependencies at the database layer too.
 */
@Injectable()
export class DependenciesRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Insert a dependency edge. ON CONFLICT DO NOTHING so re-adding the same
   * edge is idempotent (returns false rather than throwing a 23505).
   * Returns true when a new row was actually written.
   */
  async add(ticketId: number, blockerId: number): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO ticket_dependencies (ticket_id, blocker_id)
            VALUES ($1, $2)
            ON CONFLICT (ticket_id, blocker_id) DO NOTHING`,
      [ticketId, blockerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async remove(ticketId: number, blockerId: number): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ticket_dependencies
        WHERE ticket_id = $1 AND blocker_id = $2`,
      [ticketId, blockerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * The blockers of `ticketId` — tickets it is blocked by — joined to the
   * tickets table for title/status. Soft-deleted blockers are excluded; a
   * deleted ticket can't meaningfully block anything.
   */
  async listBlockers(ticketId: number): Promise<BlockerRow[]> {
    const { rows } = await this.db.query<BlockerRow>(
      `SELECT t.id, t.title, t.status
         FROM ticket_dependencies d
         JOIN tickets t ON t.id = d.blocker_id
        WHERE d.ticket_id = $1
          AND t.deleted_at IS NULL
        ORDER BY t.id ASC`,
      [ticketId],
    );
    return rows;
  }

  /**
   * Just the blocker ids of `ticketId`. Used by the cycle-detection walk
   * and by the "unresolved blockers" check on status transitions.
   */
  async blockerIdsOf(ticketId: number): Promise<number[]> {
    const { rows } = await this.db.query<{ blocker_id: number }>(
      `SELECT blocker_id FROM ticket_dependencies WHERE ticket_id = $1`,
      [ticketId],
    );
    return rows.map((r) => Number(r.blocker_id));
  }

  /**
   * Count the blockers of `ticketId` whose status is NOT DONE and that are
   * not soft-deleted. Zero means "no unresolved blockers" — the ticket is
   * free to move to DONE.
   */
  async countUnresolvedBlockers(ticketId: number): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM ticket_dependencies d
         JOIN tickets t ON t.id = d.blocker_id
        WHERE d.ticket_id = $1
          AND t.deleted_at IS NULL
          AND t.status <> 'DONE'`,
      [ticketId],
    );
    return Number(rows[0].count);
  }
}
