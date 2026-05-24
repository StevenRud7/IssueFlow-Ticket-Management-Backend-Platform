/**
 * Mirrors the `ticket_status` enum in 001_init.sql.
 *
 * Per §2.4 these have a forward-only lifecycle:
 *   TODO → IN_PROGRESS → IN_REVIEW → DONE
 *
 * Backwards transitions are rejected by TicketsService.assertLegalTransition().
 * DONE is terminal — no further transitions allowed once the ticket is DONE.
 */
export enum TicketStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
}
