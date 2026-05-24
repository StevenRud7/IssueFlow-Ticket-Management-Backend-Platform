import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { DependenciesRepository } from './dependencies.repository';
import { TicketPriority } from './entities/ticket-priority.enum';
import { TicketStatus } from './entities/ticket-status.enum';
import { TicketType } from './entities/ticket-type.enum';
import { TicketRow } from './entities/ticket.entity';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  let service: TicketsService;
  let repo: jest.Mocked<TicketsRepository>;
  let projects: jest.Mocked<ProjectsService>;
  let users: jest.Mocked<UsersService>;
  let audit: jest.Mocked<AuditService>;
  let deps: jest.Mocked<DependenciesRepository>;

  const sampleRow = (overrides: Partial<TicketRow> = {}): TicketRow => ({
    id: 1,
    title: 'Fix bug',
    description: 'details',
    status: TicketStatus.TODO,
    priority: TicketPriority.MEDIUM,
    type: TicketType.BUG,
    project_id: 1,
    assignee_id: null,
    due_date: null,
    is_overdue: false,
    version: 1,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const repoMock = {
      findByProject: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateWithVersionCheck: jest.fn(),
      softDelete: jest.fn(),
      softDeleteByProject: jest.fn(),
      workloadByProject: jest.fn().mockResolvedValue([]),
      findOverdueUnresolved: jest.fn(),
      applyEscalation: jest.fn(),
      findDeletedByProject: jest.fn(),
      findByIdAnyState: jest.fn(),
      restore: jest.fn(),
    } as unknown as jest.Mocked<TicketsRepository>;
    const projectsMock = {
      assertExists: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProjectsService>;
    const usersMock = {
      findById: jest.fn().mockResolvedValue({} as never),
    } as unknown as jest.Mocked<UsersService>;
    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;
    const depsMock = {
      countUnresolvedBlockers: jest.fn().mockResolvedValue(0),
      add: jest.fn(),
      remove: jest.fn(),
      listBlockers: jest.fn(),
      blockerIdsOf: jest.fn(),
    } as unknown as jest.Mocked<DependenciesRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: TicketsRepository, useValue: repoMock },
        { provide: ProjectsService, useValue: projectsMock },
        { provide: UsersService, useValue: usersMock },
        { provide: AuditService, useValue: auditMock },
        { provide: DependenciesRepository, useValue: depsMock },
      ],
    }).compile();

    service = module.get(TicketsService);
    repo = module.get(TicketsRepository);
    projects = module.get(ProjectsService);
    users = module.get(UsersService);
    audit = module.get(AuditService);
    deps = module.get(DependenciesRepository);
  });

  describe('create', () => {
    it('validates project existence (no audit)', async () => {
      projects.assertExists.mockRejectedValueOnce(
        new NotFoundException('project missing'),
      );
      await expect(
        service.create({ title: 't', type: TicketType.BUG, projectId: 99 }, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('validates assignee existence when provided', async () => {
      users.findById.mockRejectedValueOnce(
        new NotFoundException('user missing'),
      );
      await expect(
        service.create(
          {
            title: 't',
            type: TicketType.BUG,
            projectId: 1,
            assigneeId: 99,
          },
          1,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates successfully and audits with performedBy', async () => {
      repo.create.mockResolvedValue(sampleRow({ id: 42, title: 'New' }));
      const result = await service.create(
        { title: 'New', type: TicketType.BUG, projectId: 1 },
        7,
      );
      expect(result.id).toBe(42);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('CREATE');
      expect(entry.entityType).toBe('TICKET');
      expect(entry.performedBy).toBe(7);
    });
  });

  describe('create — auto-assignment (§3.8)', () => {
    it('auto-assigns the least-loaded developer when assigneeId is absent', async () => {
      // workloadByProject is pre-sorted: first row = least loaded.
      repo.workloadByProject.mockResolvedValue([
        { userId: 5, username: 'lightest', openTicketCount: 1 },
        { userId: 9, username: 'heavier', openTicketCount: 4 },
      ]);
      repo.create.mockImplementation(async (input) =>
        sampleRow({ id: 1, assignee_id: input.assigneeId ?? null }),
      );

      await service.create(
        { title: 'auto', type: TicketType.BUG, projectId: 1 },
        7,
      );

      // The repo should have been told to assign user 5.
      expect(repo.create.mock.calls[0][0].assigneeId).toBe(5);
      // A SYSTEM/AUTO_ASSIGN audit entry must have been emitted.
      const autoEntry = audit.log.mock.calls.find(
        (c) => c[0].action === 'AUTO_ASSIGN',
      );
      expect(autoEntry).toBeDefined();
      expect(autoEntry?.[0].actor).toBe('SYSTEM');
      expect(autoEntry?.[0].performedBy).toBeNull();
      expect(autoEntry?.[0].metadata).toMatchObject({ assigneeId: 5 });
    });

    it('does NOT auto-assign when assigneeId is explicitly provided', async () => {
      repo.create.mockResolvedValue(sampleRow({ assignee_id: 3 }));
      await service.create(
        { title: 't', type: TicketType.BUG, projectId: 1, assigneeId: 3 },
        7,
      );
      expect(repo.workloadByProject).not.toHaveBeenCalled();
      const autoEntry = audit.log.mock.calls.find(
        (c) => c[0].action === 'AUTO_ASSIGN',
      );
      expect(autoEntry).toBeUndefined();
    });

    it('creates unassigned (null) when no developers exist — no error', async () => {
      repo.workloadByProject.mockResolvedValue([]);
      repo.create.mockImplementation(async (input) =>
        sampleRow({ assignee_id: input.assigneeId ?? null }),
      );
      const result = await service.create(
        { title: 't', type: TicketType.BUG, projectId: 1 },
        7,
      );
      expect(result.assigneeId).toBeNull();
      const autoEntry = audit.log.mock.calls.find(
        (c) => c[0].action === 'AUTO_ASSIGN',
      );
      expect(autoEntry).toBeUndefined();
    });
  });

  describe('update — lifecycle', () => {
    it('400s when no updatable fields are provided', async () => {
      await expect(service.update(1, { version: 1 }, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('400s when version is omitted', async () => {
      await expect(service.update(1, { title: 'X' }, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects ANY update to a DONE ticket (no audit)', async () => {
      repo.findById.mockResolvedValue(sampleRow({ status: TicketStatus.DONE }));
      await expect(
        service.update(1, { title: 'try', version: 1 }, 1),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.updateWithVersionCheck).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('rejects backwards status transitions', async () => {
      repo.findById.mockResolvedValue(
        sampleRow({ status: TicketStatus.IN_REVIEW }),
      );
      await expect(
        service.update(1, { status: TicketStatus.IN_PROGRESS, version: 1 }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows TODO → IN_PROGRESS and audits the diff', async () => {
      repo.findById.mockResolvedValue(sampleRow({ status: TicketStatus.TODO }));
      repo.updateWithVersionCheck.mockResolvedValue(
        sampleRow({ status: TicketStatus.IN_PROGRESS, version: 2 }),
      );
      const result = await service.update(
        1,
        { status: TicketStatus.IN_PROGRESS, version: 1 },
        99,
      );
      expect(result.status).toBe(TicketStatus.IN_PROGRESS);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('UPDATE');
      expect(entry.metadata).toMatchObject({
        status: { from: 'TODO', to: 'IN_PROGRESS' },
      });
    });

    it('allows TODO → DONE when there are no blockers', async () => {
      repo.findById.mockResolvedValue(sampleRow({ status: TicketStatus.TODO }));
      deps.countUnresolvedBlockers.mockResolvedValue(0);
      repo.updateWithVersionCheck.mockResolvedValue(
        sampleRow({ status: TicketStatus.DONE, version: 2 }),
      );
      const result = await service.update(
        1,
        { status: TicketStatus.DONE, version: 1 },
        1,
      );
      expect(result.status).toBe(TicketStatus.DONE);
    });
  });

  describe('update — blocker check (§3.2)', () => {
    it('409s on transition to DONE while unresolved blockers exist', async () => {
      repo.findById.mockResolvedValue(
        sampleRow({ status: TicketStatus.IN_REVIEW }),
      );
      deps.countUnresolvedBlockers.mockResolvedValue(2);
      await expect(
        service.update(1, { status: TicketStatus.DONE, version: 1 }, 1),
      ).rejects.toThrow(/2 unresolved blocker/);
      expect(repo.updateWithVersionCheck).not.toHaveBeenCalled();
    });

    it('does NOT run the blocker check for non-DONE transitions', async () => {
      repo.findById.mockResolvedValue(sampleRow({ status: TicketStatus.TODO }));
      repo.updateWithVersionCheck.mockResolvedValue(
        sampleRow({ status: TicketStatus.IN_PROGRESS, version: 2 }),
      );
      await service.update(
        1,
        { status: TicketStatus.IN_PROGRESS, version: 1 },
        1,
      );
      expect(deps.countUnresolvedBlockers).not.toHaveBeenCalled();
    });
  });

  describe('update — optimistic locking', () => {
    it('409 with helpful message when version is stale (no audit)', async () => {
      repo.findById
        .mockResolvedValueOnce(sampleRow({ version: 5 }))
        .mockResolvedValueOnce(sampleRow({ version: 7 }));
      repo.updateWithVersionCheck.mockResolvedValue(null);
      await expect(
        service.update(1, { title: 'try', version: 5 }, 1),
      ).rejects.toThrow(/Expected version 5, current is 7/);
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('update — overdue flag', () => {
    it('passes resetOverdueFlag=true when priority is changed', async () => {
      repo.findById.mockResolvedValue(
        sampleRow({ priority: TicketPriority.LOW, is_overdue: true }),
      );
      repo.updateWithVersionCheck.mockResolvedValue(
        sampleRow({
          priority: TicketPriority.HIGH,
          is_overdue: false,
          version: 2,
        }),
      );
      await service.update(1, { priority: TicketPriority.HIGH, version: 1 }, 1);
      const args = repo.updateWithVersionCheck.mock.calls[0];
      expect(args[3]).toBe(true);
    });

    it('passes resetOverdueFlag=false when priority is NOT touched', async () => {
      repo.findById.mockResolvedValue(sampleRow({ is_overdue: true }));
      repo.updateWithVersionCheck.mockResolvedValue(sampleRow({ version: 2 }));
      await service.update(1, { title: 'rename', version: 1 }, 1);
      const args = repo.updateWithVersionCheck.mock.calls[0];
      expect(args[3]).toBe(false);
    });
  });

  describe('softDelete', () => {
    it('404s when nothing was deleted', async () => {
      repo.findById.mockResolvedValue(sampleRow());
      repo.softDelete.mockResolvedValue(false);
      await expect(service.softDelete(999, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
    it('audits DELETE on success', async () => {
      repo.findById.mockResolvedValue(sampleRow({ title: 'gone' }));
      repo.softDelete.mockResolvedValue(true);
      await service.softDelete(1, 99);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('DELETE');
      expect(entry.entityType).toBe('TICKET');
      expect(entry.performedBy).toBe(99);
      expect(entry.metadata).toMatchObject({ title: 'gone', projectId: 1 });
    });
  });

  describe('getWorkload', () => {
    it('validates the project then returns the repo result', async () => {
      repo.workloadByProject.mockResolvedValue([
        { userId: 1, username: 'a', openTicketCount: 2 },
      ]);
      const result = await service.getWorkload(1);
      expect(projects.assertExists).toHaveBeenCalledWith(1);
      expect(result).toEqual([
        { userId: 1, username: 'a', openTicketCount: 2 },
      ]);
    });
  });

  describe('findDeletedByProject', () => {
    it('validates the project and returns soft-deleted tickets', async () => {
      repo.findDeletedByProject.mockResolvedValue([
        sampleRow({ id: 9, deleted_at: new Date() }),
      ]);
      const result = await service.findDeletedByProject(1);
      expect(projects.assertExists).toHaveBeenCalledWith(1);
      expect(result[0].id).toBe(9);
    });
  });

  describe('restore', () => {
    it('404s when the ticket does not exist', async () => {
      repo.findByIdAnyState.mockResolvedValue(null);
      await expect(service.restore(99, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s when the ticket exists but is not deleted', async () => {
      repo.findByIdAnyState.mockResolvedValue(sampleRow({ deleted_at: null }));
      await expect(service.restore(1, 1)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('restores a soft-deleted ticket and audits RESTORE', async () => {
      repo.findByIdAnyState.mockResolvedValue(
        sampleRow({ id: 5, title: 'Back', deleted_at: new Date() }),
      );
      repo.restore.mockResolvedValue(true);
      await service.restore(5, 42);
      expect(repo.restore).toHaveBeenCalledWith(5);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('RESTORE');
      expect(entry.entityType).toBe('TICKET');
      expect(entry.performedBy).toBe(42);
    });
  });
});
