/**
 * Mirrors the `ticket_priority` enum in 001_init.sql.
 *
 * Ordered LOW < MEDIUM < HIGH < CRITICAL — Phase 7's auto-escalation
 * promotes overdue tickets one step up this ladder.
 */
export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Used by Phase 7's escalation logic. Exported here so the priority enum
 * stays the single source of truth.
 */
export const PRIORITY_LADDER: readonly TicketPriority[] = [
  TicketPriority.LOW,
  TicketPriority.MEDIUM,
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
];
