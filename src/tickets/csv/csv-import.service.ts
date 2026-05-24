import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../audit/entities/audit-action.enum';
import { AuditActor } from '../../audit/entities/audit-actor.enum';
import { AuditEntity } from '../../audit/entities/audit-entity.enum';
import { ProjectsService } from '../../projects/projects.service';
import { TicketPriority } from '../entities/ticket-priority.enum';
import { TicketStatus } from '../entities/ticket-status.enum';
import { TicketType } from '../entities/ticket-type.enum';
import { TicketsRepository } from '../tickets.repository';

/**
 * Per-row failure detail returned in the import summary.
 */
export interface ImportRowError {
  row: number; // 1-based data row index (header is not counted)
  message: string;
}

/**
 * The §3.4 import summary: { created, failed, errors }.
 */
export interface ImportSummary {
  created: number;
  failed: number;
  errors: ImportRowError[];
}

/**
 * CSV import (§3.4).
 *
 * POST /tickets/import accepts a CSV file plus a target projectId form
 * field, and creates tickets in bulk.
 *
 * Design choices:
 *
 *   - Per-row resilience: one bad row does NOT abort the batch. Each row
 *     is validated and inserted independently; failures are collected
 *     into `errors` and the rest still import. This matches the spec's
 *     summary shape ({ created, failed, errors }) — a fail count only
 *     makes sense if good rows still go through.
 *
 *   - `id` in the CSV is ignored on import. The export includes `id` for
 *     human reference, but tickets always get fresh DB-generated ids on
 *     import — re-using export ids would collide with existing rows.
 *
 *   - status / priority default (TODO / MEDIUM) when the cell is blank,
 *     matching the create-ticket defaults. `type` is required.
 *
 *   - assigneeId is optional; blank → unassigned. We do NOT run
 *     auto-assignment on import (auto-assignment is a creation-time
 *     convenience for the interactive API; a bulk import is an explicit
 *     data-migration tool and shouldn't silently reshuffle assignees).
 *
 *   - The whole import is wrapped so a malformed CSV (not parseable at
 *     all) is a clean 400 rather than a 500.
 */
@Injectable()
export class CsvImportService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  async importIntoProject(
    projectId: number,
    csvBuffer: Buffer,
    performedBy: number,
  ): Promise<ImportSummary> {
    // 404 if the target project doesn't exist.
    await this.projects.assertExists(projectId);

    // Parse the whole file. `columns: true` uses the header row as keys;
    // `trim` tidies whitespace; `skip_empty_lines` ignores blank lines.
    let records: Record<string, string>[];
    try {
      records = parse(csvBuffer, {
        columns: true,
        trim: true,
        skip_empty_lines: true,
        bom: true, // tolerate a UTF-8 BOM from Excel-exported CSVs
      }) as Record<string, string>[];
    } catch (err) {
      throw new BadRequestException(
        `CSV could not be parsed: ${(err as Error).message}`,
      );
    }

    const summary: ImportSummary = { created: 0, failed: 0, errors: [] };

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 1; // 1-based, header excluded
      const raw = records[i];
      try {
        const parsed = this.validateRow(raw);
        await this.tickets.create({
          title: parsed.title,
          description: parsed.description,
          status: parsed.status,
          priority: parsed.priority,
          type: parsed.type,
          projectId,
          assigneeId: parsed.assigneeId,
          dueDate: undefined,
        });
        summary.created++;
      } catch (err) {
        summary.failed++;
        summary.errors.push({
          row: rowNumber,
          message: (err as Error).message,
        });
      }
    }

    // One audit entry for the whole import operation (not per row — that
    // would flood the log). entityId is the project the import targeted.
    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: AuditEntity.PROJECT,
      entityId: projectId,
      performedBy,
      actor: AuditActor.USER,
      metadata: {
        operation: 'csv-import',
        created: summary.created,
        failed: summary.failed,
      },
    });

    return summary;
  }

  /**
   * Validate one parsed CSV row and coerce it into ticket-create input.
   * Throws an Error with a human-readable message on the first problem —
   * the caller turns that into an entry in the `errors` array.
   */
  private validateRow(raw: Record<string, string>): {
    title: string;
    description?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    type: TicketType;
    assigneeId?: number;
  } {
    const title = (raw.title ?? '').trim();
    if (!title) {
      throw new Error('title is required and must not be empty');
    }
    if (title.length > 255) {
      throw new Error('title exceeds 255 characters');
    }

    const description = (raw.description ?? '').trim();

    const typeRaw = (raw.type ?? '').trim().toUpperCase();
    if (!typeRaw) {
      throw new Error('type is required');
    }
    if (!Object.values(TicketType).includes(typeRaw as TicketType)) {
      throw new Error(
        `type "${typeRaw}" is invalid (expected one of: ${Object.values(TicketType).join(', ')})`,
      );
    }

    // status / priority: blank → leave undefined so DB defaults apply.
    let status: TicketStatus | undefined;
    const statusRaw = (raw.status ?? '').trim().toUpperCase();
    if (statusRaw) {
      if (!Object.values(TicketStatus).includes(statusRaw as TicketStatus)) {
        throw new Error(
          `status "${statusRaw}" is invalid (expected one of: ${Object.values(TicketStatus).join(', ')})`,
        );
      }
      status = statusRaw as TicketStatus;
    }

    let priority: TicketPriority | undefined;
    const priorityRaw = (raw.priority ?? '').trim().toUpperCase();
    if (priorityRaw) {
      if (
        !Object.values(TicketPriority).includes(priorityRaw as TicketPriority)
      ) {
        throw new Error(
          `priority "${priorityRaw}" is invalid (expected one of: ${Object.values(TicketPriority).join(', ')})`,
        );
      }
      priority = priorityRaw as TicketPriority;
    }

    // assigneeId: blank → unassigned. If present, must be a positive int.
    // We do NOT verify the user exists here — a non-existent assignee
    // would surface as a FK violation, which the per-row try/catch
    // captures as a failure. Validating existence per row would also be
    // an N-query cost on large imports.
    let assigneeId: number | undefined;
    const assigneeRaw = (raw.assigneeId ?? '').trim();
    if (assigneeRaw) {
      const n = Number(assigneeRaw);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(
          `assigneeId "${assigneeRaw}" is invalid (expected a positive integer)`,
        );
      }
      assigneeId = n;
    }

    return {
      title,
      description: description || undefined,
      status,
      priority,
      type: typeRaw as TicketType,
      assigneeId,
    };
  }
}
