import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-action.enum';
import { AuditActor } from '../audit/entities/audit-actor.enum';
import { AuditEntity } from '../audit/entities/audit-entity.enum';
import { BlockerRow, DependenciesRepository } from './dependencies.repository';
import { TicketsRepository } from './tickets.repository';

/**
 * Ticket dependency management (§3.2).
 *
 * A dependency (ticketId, blockerId) means "ticketId is blocked by
 * blockerId". Enforced rules:
 *
 *   - Both tickets must exist (404 otherwise).
 *   - Both must belong to the SAME project (400 otherwise) — §3.2 constraint.
 *   - No self-dependency: a ticket can't block itself (400).
 *   - No cycles: adding the edge must not create a loop. If A is blocked by
 *     B, and B (directly or transitively) is blocked by A, that's a
 *     deadlock — neither could ever reach DONE. Rejected with 400.
 *
 * The "cannot move to DONE with unresolved blockers" rule (§3.2) is
 * enforced in TicketsService.update() via countUnresolvedBlockers — not
 * here — because it's a property of the status transition, not the
 * dependency edge.
 *
 * Add/remove emit audit entries against the DEPENDENCY entity type.
 */
@Injectable()
export class DependenciesService {
  constructor(
    private readonly deps: DependenciesRepository,
    private readonly tickets: TicketsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Add "ticketId is blocked by blockerId".
   */
  async add(
    ticketId: number,
    blockerId: number,
    performedBy: number,
  ): Promise<void> {
    if (ticketId === blockerId) {
      throw new BadRequestException('A ticket cannot depend on itself');
    }

    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    const blocker = await this.tickets.findById(blockerId);
    if (!blocker) {
      throw new NotFoundException(`Ticket ${blockerId} not found`);
    }

    // §3.2: both tickets must belong to the same project.
    if (Number(ticket.project_id) !== Number(blocker.project_id)) {
      throw new BadRequestException(
        `Tickets must belong to the same project (ticket ${ticketId} is in project ${ticket.project_id}, ticket ${blockerId} is in project ${blocker.project_id})`,
      );
    }

    // Cycle check: adding "ticketId blocked by blockerId" creates a cycle
    // iff blockerId is already (transitively) blocked by ticketId. Walk the
    // blocker graph starting from blockerId; if we ever reach ticketId, the
    // new edge would close a loop.
    if (await this.wouldCreateCycle(ticketId, blockerId)) {
      throw new BadRequestException(
        `Adding this dependency would create a cycle: ticket ${blockerId} already depends (directly or transitively) on ticket ${ticketId}`,
      );
    }

    const added = await this.deps.add(ticketId, blockerId);

    // Only audit when a NEW edge was written. Re-adding an existing edge is
    // a no-op (ON CONFLICT DO NOTHING) and shouldn't spam the audit log.
    if (added) {
      await this.audit.log({
        action: AuditAction.CREATE,
        entityType: AuditEntity.DEPENDENCY,
        entityId: ticketId,
        performedBy,
        actor: AuditActor.USER,
        metadata: { ticketId, blockedBy: blockerId },
      });
    }
  }

  async remove(
    ticketId: number,
    blockerId: number,
    performedBy: number,
  ): Promise<void> {
    const removed = await this.deps.remove(ticketId, blockerId);
    if (!removed) {
      throw new NotFoundException(
        `Ticket ${ticketId} is not blocked by ticket ${blockerId}`,
      );
    }
    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: AuditEntity.DEPENDENCY,
      entityId: ticketId,
      performedBy,
      actor: AuditActor.USER,
      metadata: { ticketId, blockedBy: blockerId },
    });
  }

  /**
   * List the tickets that `ticketId` is blocked by. §3.2 / README contract:
   * returns [{ id, title, status }]. Ids are coerced to numbers — pg
   * returns BIGINT as a string, and the contract shows numeric ids.
   */
  async list(ticketId: number): Promise<BlockerRow[]> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    const rows = await this.deps.listBlockers(ticketId);
    return rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      status: r.status,
    }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Returns true if adding "ticketId blocked by blockerId" would create a
   * cycle. We do a depth-first walk of the blocker graph starting at
   * `blockerId`: if `ticketId` is reachable, the new edge closes a loop.
   *
   * `visited` guards against infinite loops in case the existing graph
   * already (improperly) contains a cycle — defensive, since our own
   * checks should prevent that, but cheap insurance.
   */
  private async wouldCreateCycle(
    ticketId: number,
    blockerId: number,
  ): Promise<boolean> {
    const visited = new Set<number>();
    const stack: number[] = [blockerId];

    while (stack.length > 0) {
      const current = stack.pop() as number;
      if (current === ticketId) {
        return true; // reached the origin — cycle
      }
      if (visited.has(current)) continue;
      visited.add(current);

      const next = await this.deps.blockerIdsOf(current);
      for (const n of next) {
        if (!visited.has(n)) stack.push(n);
      }
    }
    return false;
  }
}
