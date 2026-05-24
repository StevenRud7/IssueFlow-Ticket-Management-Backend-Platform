import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { ProjectsService } from '../../projects/projects.service';
import { TicketsRepository } from '../tickets.repository';

/**
 * CSV export (§3.4).
 *
 * GET /tickets/export?projectId=N → a CSV file with one row per ticket,
 * columns exactly as the spec dictates:
 *   id, title, description, status, priority, type, assigneeId
 *
 * `csv-stringify` handles the §3.4 constraint "must handle commas and
 * quotes inside field values correctly" — it quotes any field containing
 * a comma, quote, or newline and escapes embedded quotes by doubling
 * them, per RFC 4180.
 *
 * We use the synchronous `stringify` rather than the streaming API: a
 * project's ticket count is bounded and small enough that building the
 * whole CSV string in memory is simpler and perfectly adequate here.
 */
@Injectable()
export class CsvExportService {
  /** Column order is fixed by §3.4 — do not reorder. */
  private static readonly COLUMNS = [
    'id',
    'title',
    'description',
    'status',
    'priority',
    'type',
    'assigneeId',
  ] as const;

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Produce the CSV text for every (non-deleted) ticket in the project.
   * Validates the project exists first → 404 for a bogus projectId.
   */
  async exportProject(projectId: number): Promise<string> {
    await this.projects.assertExists(projectId);
    const rows = await this.tickets.findByProject(projectId);

    const records = rows.map((t) => ({
      id: Number(t.id),
      title: t.title,
      description: t.description ?? '',
      status: t.status,
      priority: t.priority,
      type: t.type,
      // assigneeId is left blank (not "null") when unassigned so a
      // re-import reads it back as an empty optional field.
      assigneeId: t.assignee_id === null ? '' : Number(t.assignee_id),
    }));

    return stringify(records, {
      header: true,
      columns: CsvExportService.COLUMNS as unknown as string[],
    });
  }

  /**
   * Suggested download filename for the Content-Disposition header.
   */
  filenameFor(projectId: number): string {
    return `tickets-project-${projectId}.csv`;
  }
}
