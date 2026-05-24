import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditFilterQuery } from './dto/audit-filter.query';
import { AuditInsert, AuditRepository } from './audit.repository';
import {
  AuditLogResponse,
  toAuditLogResponse,
} from './entities/audit-log.entity';

/**
 * Audit log orchestration (§3.1).
 *
 * Two responsibilities:
 *
 *   1. `log(...)` — call site used by every mutating service in the app.
 *      Failures are logged but NEVER thrown. Reasoning: audit logging is
 *      observability, not a business invariant. If we let an audit-write
 *      failure crash the request, a transient DB blip on the audit table
 *      could roll back a user's legitimate write. We accept the trade-off
 *      that audit may occasionally miss an entry vs. the user's data being
 *      rejected.
 *
 *      The exception is `logWithClient()` — when participating in an
 *      existing transaction (Phase 5 comments, Phase 7 escalation), a
 *      failure DOES propagate, because the audit row needs to roll back
 *      together with the business write. Different consistency model for
 *      a different scenario.
 *
 *   2. `find(filters)` — paginated, filtered list endpoint. Pure
 *      delegation to the repository.
 *
 * AuditService is exposed via a GLOBAL module so any service can inject
 * it without explicit imports.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repo: AuditRepository) {}

  /**
   * Fire-and-forget logger. Failures are swallowed (logged, not thrown).
   * Use this from any non-transactional call site.
   */
  async log(input: AuditInsert): Promise<void> {
    try {
      await this.repo.insert(input);
    } catch (err) {
      this.logger.error(
        `Failed to write audit entry (${input.action} ${input.entityType}/${input.entityId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Transactional variant. Use this from inside a `db.transaction(async
   * client => ...)` callback when the audit row must commit/rollback with
   * the surrounding business write. Failures propagate — that's the whole
   * point.
   */
  async logWithClient(client: PoolClient, input: AuditInsert): Promise<void> {
    await this.repo.insertWithClient(client, input);
  }

  /**
   * GET /audit-logs — returns the matching audit entries as a plain
   * array, newest first.
   *
   * The README "Get audit logs" contract shows a bare array response
   * (`[ { id, action, entityType, ... } ]`) with only filter query
   * params — entityType, entityId, action, actor — and no pagination.
   * (Contrast with /users/:id/mentions, whose README row explicitly
   * shows a { data, total, page } envelope; the two contracts differ
   * deliberately.) We therefore return the array form here.
   */
  async find(filters: AuditFilterQuery): Promise<AuditLogResponse[]> {
    const rows = await this.repo.find({
      entityType: filters.entityType,
      entityId: filters.entityId,
      action: filters.action,
      actor: filters.actor,
    });
    return rows.map(toAuditLogResponse);
  }
}