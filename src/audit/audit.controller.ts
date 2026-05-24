import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditFilterQuery } from './dto/audit-filter.query';
import { AuditLogResponse } from './entities/audit-log.entity';

/**
 * Read-only audit log endpoint per the README contract:
 *   GET /audit-logs
 *
 * Filters (all optional): entityType, entityId, action, actor.
 * Also accepts pagination (page, pageSize) inherited from PaginationQuery.
 *
 * Returns a paginated envelope `{ data, total, page }`. The README example
 * shows the raw array form — our response keeps the array under `data` and
 * adds `total`/`page`, which is the same pattern Phase 5's mentions
 * endpoint uses. A client can still read the entries from `data`.
 *
 * No POST/PATCH/DELETE here — audit_logs is append-only and writes happen
 * inside the services that perform the underlying actions, never through
 * a public endpoint.
 */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  find(@Query() query: AuditFilterQuery): Promise<AuditLogResponse[]> {
    return this.auditService.find(query);
  }
}