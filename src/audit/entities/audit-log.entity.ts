import { AuditAction } from './audit-action.enum';
import { AuditActor } from './audit-actor.enum';
import { AuditEntity } from './audit-entity.enum';

/**
 * Shape of an `audit_logs` row from pg.
 *
 * `metadata` is JSONB — pg's driver parses it into a JS object
 * automatically, so we type it as `unknown` here (a Record with unknown
 * values is the closest safe type). Callers should validate the shape if
 * they want to consume it.
 */
export interface AuditLogRow {
  id: number;
  action: AuditAction;
  entity_type: AuditEntity;
  entity_id: number;
  performed_by: number | null;
  actor: AuditActor;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Public-facing shape matching the README contract:
 *   { "id":1, "action":"CREATE", "entityType":"TICKET", "entityId":5,
 *     "performedBy":2, "actor":"USER", "timestamp":"..." }
 *
 * `metadata` is exposed too — the contract example omits it but doesn't
 * forbid additional fields, and exposing it gives clients useful context
 * (e.g. which fields changed on an UPDATE).
 */
export interface AuditLogResponse {
  id: number;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: number;
  performedBy: number | null;
  actor: AuditActor;
  metadata: Record<string, unknown>;
  timestamp: string; // ISO-8601
}

export function toAuditLogResponse(row: AuditLogRow): AuditLogResponse {
  return {
    id: Number(row.id),
    action: row.action,
    entityType: row.entity_type,
    entityId: Number(row.entity_id),
    performedBy: row.performed_by === null ? null : Number(row.performed_by),
    actor: row.actor,
    metadata: row.metadata,
    timestamp: row.timestamp.toISOString(),
  };
}
