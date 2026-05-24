import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { AuditAction } from '../entities/audit-action.enum';
import { AuditActor } from '../entities/audit-actor.enum';
import { AuditEntity } from '../entities/audit-entity.enum';

/**
 * Query params for GET /audit-logs.
 *
 * Per the README "Get audit logs" contract the only query params are the
 * four optional filters — entityType, entityId, action, actor — and the
 * response is a plain array. There is no pagination in the contract for
 * this endpoint, so this DTO does NOT extend PaginationQuery.
 *
 * Filters combine with AND semantics (everything provided must match).
 *
 * Validation:
 *   - entityType / action / actor: must be a valid enum value if present
 *   - entityId: positive integer if present
 */
export class AuditFilterQuery {
  @IsOptional()
  @IsEnum(AuditEntity, {
    message: `entityType must be one of: ${Object.values(AuditEntity).join(', ')}`,
  })
  entityType?: AuditEntity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  entityId?: number;

  @IsOptional()
  @IsEnum(AuditAction, {
    message: `action must be one of: ${Object.values(AuditAction).join(', ')}`,
  })
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditActor, {
    message: `actor must be one of: ${Object.values(AuditActor).join(', ')}`,
  })
  actor?: AuditActor;
}