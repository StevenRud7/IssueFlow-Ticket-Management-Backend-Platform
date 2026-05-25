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
import { UsersService } from '../users/users.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ProjectResponse,
  ProjectRow,
  toProjectResponse,
} from './entities/project.entity';
import { ProjectsRepository } from './projects.repository';

/**
 * Projects business logic (§2.3).
 *
 * - create() pre-validates that `ownerId` references an existing user, so
 *   the response is `404 owner not found` rather than the DB's raw FK
 *   violation. The DB constraint is still there as the race safety net.
 *
 * - update() requires at least one mutable field to be present.
 *
 * - DELETE is a soft-delete: sets `deleted_at = NOW()`. Subsequent reads
 *   pretend the row doesn't exist (the repository already filters
 *   `deleted_at IS NULL`). Tickets that belong to the deleted project keep
 *   their FK and are NOT cascade-soft-deleted in this phase — the PDF
 *   doesn't require it, and explicit user action keeps semantics clean.
 *   Phase 8 adds the ADMIN-only restore endpoint.
 *
 * Phase 6: emits audit entries for CREATE/UPDATE/DELETE.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lists all active projects as ProjectResponse objects. Used by
   * GET /projects.
   */
  async findAll(): Promise<ProjectResponse[]> {
    const rows = await this.projects.findAll();
    return rows.map(toProjectResponse);
  }

  /**
   * Returns one project by id. Throws 404 (via getOrThrow) if it doesn't
   * exist or has been soft-deleted. Used by GET /projects/:id.
   */
  async findById(id: number): Promise<ProjectResponse> {
    return toProjectResponse(await this.getOrThrow(id));
  }

  /**
   * Creates a project. Validates the owner exists first (a missing owner
   * is a 404, clearer than the database's foreign-key error). Records a
   * CREATE audit entry.
   */
  async create(
    dto: CreateProjectDto,
    performedBy: number,
  ): Promise<ProjectResponse> {
    // Pre-validate the owner exists; UsersService.findById throws NotFound
    // which surfaces as 404. That's more informative than the DB's FK error.
    await this.users.findById(dto.ownerId);

    const row = await this.projects.create({
      name: dto.name,
      description: dto.description,
      ownerId: dto.ownerId,
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: AuditEntity.PROJECT,
      entityId: Number(row.id),
      performedBy,
      actor: AuditActor.USER,
      metadata: {
        name: row.name,
        ownerId: Number(row.owner_id),
      },
    });

    return toProjectResponse(row);
  }

  /**
   * Updates a project's name and/or description (§2.3). Requires at least
   * one field — a no-op update is a 400. Throws 404 if the project is
   * absent or soft-deleted. Records an UPDATE audit entry with a
   * before/after field diff.
   */
  async update(
    id: number,
    dto: UpdateProjectDto,
    performedBy: number,
  ): Promise<ProjectResponse> {
    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException(
        'At least one of "name" or "description" must be provided',
      );
    }
    const before = await this.getOrThrow(id);

    const updated = await this.projects.update(id, dto);
    if (!updated) {
      // Tight race: deleted between getOrThrow and update.
      throw new NotFoundException(`Project ${id} not found`);
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntity.PROJECT,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: diffMetadata(before, updated, ['name', 'description']),
    });

    return toProjectResponse(updated);
  }

  /**
   * Soft-deletes a project (§3.5) — sets `deleted_at` rather than removing
   * the row, so it can be restored later. Throws 404 if the project is
   * already absent. Records a DELETE audit entry.
   */
  async softDelete(id: number, performedBy: number): Promise<void> {
    const before = await this.getOrThrow(id);
    const deleted = await this.projects.softDelete(id);
    if (!deleted) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: AuditEntity.PROJECT,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: { name: before.name },
    });
  }

  /**
   * Internal helper — other modules (Phase 4 Tickets) call this to ensure
   * a project exists before linking tickets to it.
   */
  async assertExists(id: number): Promise<void> {
    await this.getOrThrow(id);
  }

  // ---------------------------------------------------------------------------
  // Phase 8: soft-delete management (ADMIN-only — guard enforced at controller)
  // ---------------------------------------------------------------------------

  /**
   * List soft-deleted projects (§3.5).
   */
  async findDeleted(): Promise<ProjectResponse[]> {
    const rows = await this.projects.findDeleted();
    return rows.map(toProjectResponse);
  }

  /**
   * Restore a soft-deleted project (§3.5). 404 if no project with that id
   * exists at all; 409 if it exists but isn't deleted (nothing to restore).
   *
   * Restoring a project does NOT cascade to its tickets — those keep
   * whatever deleted_at state they had. The PDF doesn't require cascade,
   * and keeping the operations independent is the least-surprising
   * behaviour (an ADMIN restores exactly what they asked for).
   */
  async restore(id: number, performedBy: number): Promise<void> {
    const existing = await this.projects.findByIdAnyState(id);
    if (!existing) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    if (existing.deleted_at === null) {
      throw new ConflictException(
        `Project ${id} is not deleted; nothing to restore`,
      );
    }
    await this.projects.restore(id);

    await this.audit.log({
      action: AuditAction.RESTORE,
      entityType: AuditEntity.PROJECT,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: { name: existing.name },
    });
  }

  private async getOrThrow(id: number): Promise<ProjectRow> {
    const row = await this.projects.findById(id);
    if (!row) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return row;
  }
}