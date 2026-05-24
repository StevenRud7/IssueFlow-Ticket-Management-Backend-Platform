import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-action.enum';
import { AuditActor } from '../audit/entities/audit-actor.enum';
import { AuditEntity } from '../audit/entities/audit-entity.enum';
import {
  PRIORITY_LADDER,
  TicketPriority,
} from '../tickets/entities/ticket-priority.enum';
import { TicketsRepository } from '../tickets/tickets.repository';

/**
 * The escalation algorithm (§3.7), deliberately separated from the cron
 * trigger (EscalationScheduler) so it can be unit-tested directly without
 * dealing with timers.
 *
 * One `runOnce()` cycle:
 *
 *   1. Find every overdue, unresolved ticket (dueDate in the past, status
 *      != DONE, not soft-deleted) — that filtering is done in SQL.
 *
 *   2. For each:
 *        - priority below CRITICAL → promote one level up the ladder
 *          (LOW → MEDIUM → HIGH → CRITICAL).
 *        - priority already CRITICAL → set is_overdue = TRUE (idempotent —
 *          re-running does nothing once the flag is set).
 *
 *   3. Each change emits a PRIORITY_ESCALATED audit entry with
 *      actor = SYSTEM, performedBy = null.
 *
 * Constraints honoured:
 *   - Idempotent: CRITICAL tickets are never escalated further; the
 *     is_overdue write is a no-op if already true.
 *   - Only tickets with a dueDate are considered (the SQL filters on
 *     `due_date IS NOT NULL`).
 *   - Status is never touched — only priority and is_overdue.
 *   - The "manual priority change resets escalation state" rule lives in
 *     TicketsService.update() (it clears is_overdue when priority is
 *     PATCHed); this service just re-evaluates from whatever the current
 *     priority is on the next cycle.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Run a single escalation cycle. Returns a small summary so the
   * scheduler can log it and tests can assert on it.
   */
  async runOnce(): Promise<{
    scanned: number;
    promoted: number;
    markedOverdue: number;
    skipped: number;
  }> {
    const overdue = await this.tickets.findOverdueUnresolved();
    let promoted = 0;
    let markedOverdue = 0;
    let skipped = 0;

    for (const ticket of overdue) {
      const currentPriority = ticket.priority;

      if (currentPriority !== TicketPriority.CRITICAL) {
        // Promote one level up the ladder.
        const next = EscalationService.nextPriority(currentPriority);
        const updated = await this.tickets.applyEscalation(Number(ticket.id), {
          kind: 'promote',
          newPriority: next,
        });
        if (!updated) {
          // Ticket was resolved/deleted between the scan and the update.
          skipped++;
          continue;
        }
        promoted++;
        await this.audit.log({
          action: AuditAction.PRIORITY_ESCALATED,
          entityType: AuditEntity.TICKET,
          entityId: Number(ticket.id),
          performedBy: null,
          actor: AuditActor.SYSTEM,
          metadata: {
            priority: { from: currentPriority, to: next },
          },
        });
      } else if (!ticket.is_overdue) {
        // Already CRITICAL and not yet flagged — set is_overdue.
        const updated = await this.tickets.applyEscalation(Number(ticket.id), {
          kind: 'mark_overdue',
        });
        if (!updated) {
          skipped++;
          continue;
        }
        markedOverdue++;
        await this.audit.log({
          action: AuditAction.PRIORITY_ESCALATED,
          entityType: AuditEntity.TICKET,
          entityId: Number(ticket.id),
          performedBy: null,
          actor: AuditActor.SYSTEM,
          metadata: {
            isOverdue: { from: false, to: true },
            priority: TicketPriority.CRITICAL,
          },
        });
      } else {
        // CRITICAL and already flagged overdue — nothing to do
        // (idempotency). Counted as skipped for the summary.
        skipped++;
      }
    }

    const summary = {
      scanned: overdue.length,
      promoted,
      markedOverdue,
      skipped,
    };
    if (overdue.length > 0) {
      this.logger.log(
        `Escalation cycle: scanned=${summary.scanned} promoted=${summary.promoted} markedOverdue=${summary.markedOverdue} skipped=${summary.skipped}`,
      );
    }
    return summary;
  }

  /**
   * The next priority one step up the ladder. Never called for CRITICAL
   * (the caller guards against that), but if it somehow were, returns
   * CRITICAL — there's nothing higher.
   */
  private static nextPriority(p: TicketPriority): TicketPriority {
    const idx = PRIORITY_LADDER.indexOf(p);
    if (idx < 0 || idx >= PRIORITY_LADDER.length - 1) {
      return TicketPriority.CRITICAL;
    }
    return PRIORITY_LADDER[idx + 1];
  }
}
