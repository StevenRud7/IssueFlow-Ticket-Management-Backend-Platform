/**
 * Mirrors the `audit_action` Postgres enum from 001_init.sql.
 *
 * Categories:
 *   - CRUD-like: CREATE, UPDATE, DELETE, RESTORE
 *   - Automated: AUTO_ASSIGN (Phase 7), PRIORITY_ESCALATED (Phase 7)
 *   - Session:   LOGIN, LOGOUT
 *
 * Phase 6 wires CREATE/UPDATE/DELETE across every mutating service. The
 * automated and session actions are added later when their owning phases
 * arrive.
 */
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  RESTORE = 'RESTORE',
  AUTO_ASSIGN = 'AUTO_ASSIGN',
  PRIORITY_ESCALATED = 'PRIORITY_ESCALATED',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
}
