/**
 * Mirrors the `audit_entity` Postgres enum from 001_init.sql.
 *
 * Every audit entry references one entity_type + entity_id. The READ
 * endpoint accepts entityType as a filter so clients can ask "show me
 * everything that happened to ticket 5".
 */
export enum AuditEntity {
  USER = 'USER',
  PROJECT = 'PROJECT',
  TICKET = 'TICKET',
  COMMENT = 'COMMENT',
  ATTACHMENT = 'ATTACHMENT',
  DEPENDENCY = 'DEPENDENCY',
}
