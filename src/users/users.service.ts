import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-action.enum';
import { AuditActor } from '../audit/entities/audit-actor.enum';
import { AuditEntity } from '../audit/entities/audit-entity.enum';
import { diffMetadata } from '../common/utils/diff-metadata';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponse, UserRow, toUserResponse } from './entities/user.entity';
import { UsersRepository } from './users.repository';

/**
 * Business rules and orchestration for the Users feature.
 *
 *  - Hashes passwords with bcrypt before insert; the raw password never
 *    leaves the service.
 *
 *  - Pre-checks uniqueness so the response is `409 Conflict` with a
 *    helpful "username already taken" message instead of the raw
 *    `unique_violation` SQLSTATE. The PgExceptionFilter (Phase 1) is a
 *    safety net for any race we don't catch here.
 *
 *  - `NotFoundException` for missing users — surfaces as 404 globally.
 *
 *  - Update requires at least one mutable field (`fullName` or `role`);
 *    sending an empty body is a 400.
 *
 *  - Phase 6: emits audit entries for CREATE/UPDATE/DELETE. The UPDATE
 *    entry's metadata captures the changed fields' old → new values so
 *    a reader can reconstruct what changed without comparing snapshots.
 *
 *  - Hash strength: 10 rounds is the bcrypt default and a reasonable
 *    balance for a take-home; production would tune against target HW.
 */
@Injectable()
export class UsersService {
  private static readonly BCRYPT_ROUNDS = 10;

  constructor(
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async findAll(): Promise<UserResponse[]> {
    const rows = await this.users.findAll();
    return rows.map(toUserResponse);
  }

  async findById(id: number): Promise<UserResponse> {
    return toUserResponse(await this.getOrThrow(id));
  }

  /**
   * `performedBy` is null for the public registration endpoint. We
   * substitute the newly-created user's id so the audit entry attributes
   * the action to the user themselves (self-creation).
   */
  async create(
    dto: CreateUserDto,
    performedBy: number | null,
  ): Promise<UserResponse> {
    const existingByUsername = await this.users.findByUsername(dto.username);
    if (existingByUsername) {
      throw new ConflictException(
        `Username "${dto.username}" is already taken`,
      );
    }

    // Per the README contract `password` is optional. Hash it only when
    // the client actually supplied one; otherwise the user is created with
    // a null password_hash and cannot log in until a password is set.
    const passwordHash =
      dto.password !== undefined
        ? await bcrypt.hash(dto.password, UsersService.BCRYPT_ROUNDS)
        : null;

    const row = await this.users.create({
      username: dto.username,
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      passwordHash,
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: AuditEntity.USER,
      entityId: Number(row.id),
      performedBy: performedBy ?? Number(row.id),
      actor: AuditActor.USER,
      metadata: {
        username: row.username,
        email: row.email,
        role: row.role,
      },
    });

    return toUserResponse(row);
  }

  async update(
    id: number,
    dto: UpdateUserDto,
    performedBy: number,
  ): Promise<UserResponse> {
    if (dto.fullName === undefined && dto.role === undefined) {
      throw new BadRequestException(
        'At least one of "fullName" or "role" must be provided',
      );
    }
    const before = await this.getOrThrow(id);

    const updated = await this.users.update(id, {
      fullName: dto.fullName,
      role: dto.role,
    });
    if (!updated) {
      throw new NotFoundException(`User ${id} not found`);
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: AuditEntity.USER,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: diffMetadata(before, updated, ['full_name', 'role']),
    });

    return toUserResponse(updated);
  }

  async delete(id: number, performedBy: number): Promise<void> {
    // Confirm the row exists before deletion so the audit entry captures
    // the username/role being deleted.
    const before = await this.getOrThrow(id);
    const deleted = await this.users.delete(id);
    if (!deleted) {
      throw new NotFoundException(`User ${id} not found`);
    }

    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: AuditEntity.USER,
      entityId: id,
      performedBy,
      actor: AuditActor.USER,
      metadata: {
        username: before.username,
        role: before.role,
      },
    });
  }

  /**
   * Returns the raw row including `password_hash`. Only callers inside the
   * server (AuthService in Phase 3) should use this. The public-facing
   * methods always go through `toUserResponse()`.
   */
  async findRawByUsername(username: string): Promise<UserRow | null> {
    return this.users.findByUsername(username);
  }

  /**
   * Bulk, case-insensitive username lookup. Used by CommentsService (Phase 5)
   * to resolve @mentions to user ids in a single SQL query rather than N+1.
   * Returns only the users that exist; unknown usernames are silently
   * dropped (matching §3.6's "don't fail the comment on a typo'd mention").
   */
  async findRawByUsernamesLower(usernames: string[]): Promise<UserRow[]> {
    return this.users.findByUsernamesLower(usernames);
  }

  private async getOrThrow(id: number): Promise<UserRow> {
    const row = await this.users.findById(id);
    if (!row) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return row;
  }
}