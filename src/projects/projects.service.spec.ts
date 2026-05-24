import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { ProjectRow } from './entities/project.entity';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repo: jest.Mocked<ProjectsRepository>;
  let users: jest.Mocked<UsersService>;
  let audit: jest.Mocked<AuditService>;

  const sampleRow = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
    id: 1,
    name: 'Sample',
    description: 'desc',
    owner_id: 1,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const repoMock = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      findDeleted: jest.fn(),
      findByIdAnyState: jest.fn(),
      restore: jest.fn(),
    } as unknown as jest.Mocked<ProjectsRepository>;
    const usersMock = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: ProjectsRepository, useValue: repoMock },
        { provide: UsersService, useValue: usersMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get(ProjectsService);
    repo = module.get(ProjectsRepository);
    users = module.get(UsersService);
    audit = module.get(AuditService);
  });

  describe('create', () => {
    it('rejects when owner does not exist (no audit)', async () => {
      users.findById.mockRejectedValue(new NotFoundException('not found'));
      await expect(
        service.create({ name: 'X', ownerId: 999 }, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('audits CREATE on success', async () => {
      users.findById.mockResolvedValue({} as never);
      repo.create.mockResolvedValue(sampleRow({ name: 'X', owner_id: 5 }));
      const result = await service.create({ name: 'X', ownerId: 5 }, 99);
      expect(result.ownerId).toBe(5);
      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('CREATE');
      expect(entry.entityType).toBe('PROJECT');
      expect(entry.performedBy).toBe(99);
    });
  });

  describe('findById', () => {
    it('returns the project when found', async () => {
      repo.findById.mockResolvedValue(sampleRow());
      const result = await service.findById(1);
      expect(result.id).toBe(1);
    });
    it('throws 404 when missing or soft-deleted', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('400s on empty body', async () => {
      await expect(service.update(1, {}, 99)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
    it('404s when project does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.update(99, { name: 'New' }, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
    it('audits UPDATE with a from→to diff', async () => {
      repo.findById.mockResolvedValue(sampleRow({ name: 'Old' }));
      repo.update.mockResolvedValue(sampleRow({ name: 'Renamed' }));
      await service.update(1, { name: 'Renamed' }, 99);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('UPDATE');
      expect(entry.metadata).toEqual({
        name: { from: 'Old', to: 'Renamed' },
      });
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
      repo.findById.mockResolvedValue(sampleRow({ name: 'Bye' }));
      repo.softDelete.mockResolvedValue(true);
      await service.softDelete(1, 99);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('DELETE');
      expect(entry.metadata).toEqual({ name: 'Bye' });
    });
  });

  describe('findDeleted', () => {
    it('returns the soft-deleted projects', async () => {
      repo.findDeleted.mockResolvedValue([
        sampleRow({ id: 9, deleted_at: new Date() }),
      ]);
      const result = await service.findDeleted();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(9);
    });
  });

  describe('restore', () => {
    it('404s when the project does not exist at all', async () => {
      repo.findByIdAnyState.mockResolvedValue(null);
      await expect(service.restore(99, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s when the project exists but is not deleted', async () => {
      repo.findByIdAnyState.mockResolvedValue(sampleRow({ deleted_at: null }));
      await expect(service.restore(1, 1)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('restores a soft-deleted project and audits RESTORE', async () => {
      repo.findByIdAnyState.mockResolvedValue(
        sampleRow({ id: 5, name: 'Back', deleted_at: new Date() }),
      );
      repo.restore.mockResolvedValue(true);
      await service.restore(5, 42);
      expect(repo.restore).toHaveBeenCalledWith(5);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('RESTORE');
      expect(entry.entityType).toBe('PROJECT');
      expect(entry.performedBy).toBe(42);
    });
  });
});
