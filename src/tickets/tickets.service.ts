import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-action.enum';
import { AuditActor } from '../audit/entities/audit-actor.enum';
import { AuditEntity } from '../audit/entities/audit-entity.enum';
import { diffMetadata } from '../common/utils/diff-metadata';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { DependenciesRepository } from './dependencies.repository';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketStatus } from './entities/ticket-status.enum';
import {
  TicketResponse,
  TicketRow,
  toTicketResponse,
} from './entities/ticket.entity';
import { TicketsRepository } from './tickets.repository';

/**
 * Forward-only status transitions (§2.4).
 *
 * TODO       → IN_PROGRESS | IN_REVIEW | DONE
 * IN_PROGRESS → IN_REVIEW   | DONE
 * IN_REVIEW   → DONE
 * DONE        → (terminal — no transitions allowed)
 */
const STATUS_ORDER: Record<TicketStatus, number> = {
  [TicketStatus.TODO]: 0,
  [TicketStatus.IN_PROGRESS]: 1,
  [TicketStatus.IN_REVIEW]: 2,
  [TicketStatus.DONE]: 3,
};

/**
 * Tickets business logic for the Phase 4 scope, instrumented in Phase 6.
 *
 * Key rules:
 *
 *   - DONE is terminal: once status === DONE, NO updates are allowed.
 *   - Forward-only status transitions (§2.4).
 *   - Optimistic locking via `version`.
 *   - Pre-validation: projectId must exist (404 if not), assigneeId (when
 *     present) must exist.
 *
 * Phase 6: emits CREATE/UPDATE/DELETE audit entries. UPDATE metadata
 * captures every changed column as a `{ from, to }` diff so the audit
 * reader can reconstruct exactly what happened.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly deps: DependenciesRepository,
  ) {}

  /**
   * Lists all active tickets in a project as TicketResponse objects.
   * Validates the project exists first (404 otherwise). Backs
   * GET /tickets?projectId=N.
   */
  async findByProject(projectId: number): Promise<TicketResponse[]> {
    await this.projects.assertExists(projectId);
    const rows = await this.tickets.findByProject(projectId);
    return rows.map(toTicketResponse);
  }

  /**
   * Lists every active ticket across all projects. Backs GET /tickets
   * when no projectId filter is supplied.
   */
  async findAll(): Promise<TicketResponse[]> {
    const rows = await this.tickets.findAll();
    return rows.map(toTicketResponse);
  }

  /**
   * Returns one ticket by id. Throws 404 (via getOrThrow) if absent or
   * soft-deleted. Backs GET /tickets/:id.
   */
  async findById(id: number): Promise<TicketResponse> {
    return toTicketResponse(await this.getOrThrow(id));
  }

  /**
   * Creates a ticket. Validates the project (and the explicit assignee, if
   * given) exist. When no assigneeId is supplied, applies §3.8
   * auto-assignment to the least-loaded DEVELOPER. Records a CREATE audit
   * entry, plus an AUTO_ASSIGN (SYSTEM-actor) entry when auto-assignment
   * fired.
   */
  async create(
    dto: CreateTicketDto,
    performedBy: number,
  ): Promise<TicketResponse> {
    await this.projects.assertExists(dto.projectId);
    if (dto.assigneeId !== undefined) {
      await this.users.findById(dto.assigneeId);
    }

    // §3.8 Auto-assignment: when no assigneeId is supplied, pick the
    // least-loaded DEVELOPER in the project. `workloadByProject` already
    // sorts by (open count ASC, registration order ASC), so the first row
    // is the pick. No developers → assignedBy stays undefined → ticket is
    // created unassigned, no error.
    let autoAssignedId: number | undefined;
    if (dto.assigneeId === undefined) {
      const workload = await this.tickets.workloadByProject(dto.projectId);
      if (workload.length > 0) {
        autoAssignedId = workload[0].userId;
      }
    }
    const effectiveAssignee = dto.assigneeId ?? autoAssignedId;

    const row = await this.tickets.create({
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      type: dto.type,
      projectId: dto.projectId,
      assigneeId: effectiveAssignee,
      dueDate: dto.dueDate,
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: AuditEntity.TICKET,
      entityId: Number(row.id),
      performedBy,
      actor: AuditActor.USER,
      metadata: {
        title: row.title,
        projectId: Number(row.project_id),
        type: row.type,
        status: row.status,
        priority: row.priority,
        assigneeId: row.assignee_id === null ? null : Number(row.assignee_id),
      },
    });

    // §3.8: a SEPARATE audit entry for the auto-assignment itself, with
    // actor = SYSTEM and action = AUTO_ASSIGN. Only emitted when the
    // system actually chose the assignee (not when the client supplied one).
    if (autoAssignedId !== undefined) {
      await this.audit.log({
        action: AuditAction.AUTO_ASSIGN,
        entityType: AuditEntity.TICKET,
        entityId: Number(row.id),
        performedBy: null,
        actor: AuditActor.SYSTEM,
        metadata: {
          assigneeId: autoAssignedId,
          reason: 'least-loaded DEVELOPER in project',
        },
      });
    }

    return toTicketResponse(row);
  }

  /**
   * Updates a ticket. Enforces the §2.4 rules: optimistic locking via
   * `version` (stale version → 409), a DONE ticket is terminal (any update
   * → 409), status may only move forward in the lifecycle (backward → 400),
   * and a ticket can't move to DONE while it has unresolved blockers (409).
   * A manual priority change clears the `is_overdue` escalation flag (§3.7).
   * Records an UPDATE audit entry with a before/after field diff.
   */
  async update(
    id: number,
    dto: UpdateTicketDto,
    performedBy: number,
  ): Promise<TicketResponse> {
    const hasUpdate =
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.status !== undefined ||
      dto.priority !== undefined ||
      dto.assigneeId !== undefined ||
      dto.dueDate !== undefined;
    if (!hasUpdate) {
      throw new BadRequestException(
        'At least one updatable field must be provided',
      );
    }
    if (dto.version === undefined) {
      throw new BadRequestException(
        '"version" is required for concurrency control. Send the value from the most recent ticket response.',
      );
    }

    const before = await this.getOrThrow(id);

    if (before.status === TicketStatus.DONE) {
      throw new ConflictException(`Ticket ${id} is DONE and cannot be updated`);
    }

    if (dto.status !== undefined && dto.status !== before.status) {
      this.assertLegalTransition(before.status, dto.status);
    }

    // §3.2: a ticket cannot transition to DONE while it has unresolved
    // blockers (blocker tickets that are not themselves DONE). Checked
    // only when the target status is DONE.
    if (dto.status === TicketStatus.DONE) {
      const unresolved = await this.deps.countUnresolvedBlockers(id);
      if (unresolved > 0) {
        throw new ConflictException(
          `Ticket ${id} cannot move to DONE: it has ${unresolved} unresolved blocker(s). Resolve them first.`,
        );
      }
    }

    if (dto.assigneeId !== undefined) {
      await this.users.findById(dto.assigneeId);
    }

    // §3.7: resetting is_overdue when priority is manually changed so the
    // next escalation cycle re-evaluates.
    const resetOverdueFlag = dto.priority !== undefined;

    const updated = await this.tickets.updateWithVersionCheck(
      id,
      dto.version,
      {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate,
      },
      resetOverdueFlag,
    );

    if (!updated) {
      const live = await this.tickets.findById(id);
      const liveVersion = live?.version ?? '?';
      throw new ConflictException(
        `Ticket ${id} was modified by another writer. Expected version ${dto.version}, current is ${liveVersion}. Please reload and retry.`,
      );
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntity.TICKET,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: diffMetadata(before, updated, [
        'title',
        'description',
        'status',
        'priority',
        'assignee_id',
        'due_date',
        'is_overdue',
      ]),
    });

    return toTicketResponse(updated);
  }

  /**
   * Soft-deletes a ticket (§3.5) — sets `deleted_at` so it disappears from
   * normal queries but can be restored. Throws 404 if already absent.
   * Records a DELETE audit entry.
   */
  async softDelete(id: number, performedBy: number): Promise<void> {
    const before = await this.getOrThrow(id);
    const deleted = await this.tickets.softDelete(id);
    if (!deleted) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }

    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: AuditEntity.TICKET,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: {
        title: before.title,
        projectId: Number(before.project_id),
      },
    });
  }

  /**
   * Internal helper for Phase 5 (Comments): does the ticket exist?
   * Returns the row so comment creation can fetch project_id without a
   * second SELECT.
   */
  async assertExistsAndGet(id: number): Promise<TicketRow> {
    return this.getOrThrow(id);
  }

  /**
   * §3.8 GET /projects/:projectId/workload — list of
   * { userId, username, openTicketCount } for every DEVELOPER, sorted by
   * openTicketCount ascending (ties broken by registration order).
   */
  async getWorkload(
    projectId: number,
  ): Promise<{ userId: number; username: string; openTicketCount: number }[]> {
    await this.projects.assertExists(projectId);
    return this.tickets.workloadByProject(projectId);
  }

  // ---------------------------------------------------------------------------
  // Phase 8: soft-delete management (ADMIN-only — guard enforced at controller)
  // ---------------------------------------------------------------------------

  /**
   * List soft-deleted tickets of one project (§3.5).
   */
  async findDeletedByProject(projectId: number): Promise<TicketResponse[]> {
    await this.projects.assertExists(projectId);
    const rows = await this.tickets.findDeletedByProject(projectId);
    return rows.map(toTicketResponse);
  }

  /**
   * Restore a soft-deleted ticket (§3.5). 404 if no ticket with that id
   * exists at all; 409 if it exists but isn't deleted.
   */
  async restore(id: number, performedBy: number): Promise<void> {
    const existing = await this.tickets.findByIdAnyState(id);
    if (!existing) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    if (existing.deleted_at === null) {
      throw new ConflictException(
        `Ticket ${id} is not deleted; nothing to restore`,
      );
    }
    await this.tickets.restore(id);

    await this.audit.log({
      action: AuditAction.RESTORE,
      entityType: AuditEntity.TICKET,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: {
        title: existing.title,
        projectId: Number(existing.project_id),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async getOrThrow(id: number): Promise<TicketRow> {
    const row = await this.tickets.findById(id);
    if (!row) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    return row;
  }

  private assertLegalTransition(
    current: TicketStatus,
    next: TicketStatus,
  ): void {
    const c = STATUS_ORDER[current];
    const n = STATUS_ORDER[next];
    if (n < c) {
      throw new BadRequestException(
        `Illegal status transition ${current} → ${next}. Status moves forward only.`,
      );
    }
  }
}