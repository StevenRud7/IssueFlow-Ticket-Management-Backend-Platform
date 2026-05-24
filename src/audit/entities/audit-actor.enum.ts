/**
 * Mirrors the `audit_actor` Postgres enum from 001_init.sql.
 *
 * Distinguishes user-initiated actions (USER, performed_by = user id)
 * from automated/scheduled actions (SYSTEM, performed_by = NULL).
 *
 * Phase 6 only writes USER entries; Phase 7's escalation scheduler and
 * auto-assignment write SYSTEM entries.
 */
export enum AuditActor {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}
