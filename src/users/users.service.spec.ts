import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { UserRole } from './entities/user-role.enum';
import { UserRow } from './entities/user.entity';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * Pure unit tests — the repository and AuditService are mocked, so no DB
 * required.
 *
 * Phase 6 additions:
 *   - audit.log called on CREATE/UPDATE/DELETE with the right shape
 *   - UPDATE metadata is a from→to diff of only changed fields
 *   - DELETE metadata snapshots username/role from BEFORE the delete
 */
describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<UsersRepository>;
  let audit: jest.Mocked<AuditService>;

  const sampleRow = (overrides: Partial<UserRow> = {}): UserRow => ({
    id: 1,
    username: 'jdoe',
    email: 'jdoe@example.com',
    full_name: 'John Doe',
    role: UserRole.DEVELOPER,
    password_hash: 'irrelevant',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const repoMock = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByUsername: jest.fn(),
      findByUsernamesLower: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repoMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get(UsersService);
    repo = module.get(UsersRepository);
    audit = module.get(AuditService);
  });

  describe('findAll', () => {
    it('returns response-shaped users (no password hash)', async () => {
      repo.findAll.mockResolvedValue([sampleRow(), sampleRow({ id: 2 })]);
      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        username: 'jdoe',
        email: 'jdoe@example.com',
        fullName: 'John Doe',
        role: UserRole.DEVELOPER,
      });
      expect(result[0]).not.toHaveProperty('password_hash');
      expect(result[0]).not.toHaveProperty('passwordHash');
    });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      repo.findById.mockResolvedValue(sampleRow());
      const result = await service.findById(1);
      expect(result.username).toBe('jdoe');
    });
    it('throws NotFound when missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('hashes the password and never returns it', async () => {
      repo.findByUsername.mockResolvedValue(null);
      repo.create.mockImplementation(async (input) =>
        sampleRow({
          username: input.username,
          email: input.email,
          full_name: input.fullName,
          role: input.role,
          password_hash: input.passwordHash,
        }),
      );

      const result = await service.create(
        {
          username: 'jdoe',
          email: 'jdoe@example.com',
          fullName: 'John Doe',
          role: UserRole.DEVELOPER,
          password: 'plaintext-password',
        },
        null,
      );

      const createArgs = repo.create.mock.calls[0][0];
      expect(createArgs.passwordHash).not.toBe('plaintext-password');
      expect(createArgs.passwordHash).not.toBeNull();
      expect(
        await bcrypt.compare(
          'plaintext-password',
          createArgs.passwordHash as string,
        ),
      ).toBe(true);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });

    it('creates a user WITHOUT a password (README contract body)', async () => {
      // The README "Create a user" body is { username, email, fullName,
      // role } — no password — and returns 200 OK. Verify that path: the
      // user is created and passwordHash is stored as null.
      repo.findByUsername.mockResolvedValue(null);
      repo.create.mockImplementation(async (input) =>
        sampleRow({ password_hash: input.passwordHash }),
      );

      const result = await service.create(
        {
          username: 'nopass',
          email: 'nopass@example.com',
          fullName: 'No Password',
          role: UserRole.DEVELOPER,
          // password intentionally omitted
        },
        null,
      );

      const createArgs = repo.create.mock.calls[0][0];
      expect(createArgs.passwordHash).toBeNull();
      expect(result.username).toBe('jdoe'); // from sampleRow defaults
      expect(result).not.toHaveProperty('password_hash');
    });

    it('rejects duplicate usernames with 409 and does NOT audit', async () => {
      repo.findByUsername.mockResolvedValue(sampleRow());
      await expect(
        service.create(
          {
            username: 'jdoe',
            email: 'other@example.com',
            fullName: 'Other',
            role: UserRole.DEVELOPER,
            password: 'whatever123',
          },
          null,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('audits self-creation when performedBy is null', async () => {
      repo.findByUsername.mockResolvedValue(null);
      repo.create.mockResolvedValue(sampleRow({ id: 42 }));
      await service.create(
        {
          username: 'jdoe',
          email: 'j@e.com',
          fullName: 'J',
          role: UserRole.DEVELOPER,
          password: 'plaintext',
        },
        null,
      );
      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('CREATE');
      expect(entry.entityType).toBe('USER');
      expect(entry.entityId).toBe(42);
      expect(entry.performedBy).toBe(42); // self-creation
      expect(entry.actor).toBe('USER');
    });
  });

  describe('update', () => {
    it('400s when both fields are absent (no audit)', async () => {
      await expect(service.update(1, {}, 99)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('404s when the user is missing (no audit)', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.update(999, { fullName: 'New Name' }, 99),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('audits UPDATE with a from→to diff of only changed fields', async () => {
      repo.findById.mockResolvedValue(
        sampleRow({ full_name: 'Old', role: UserRole.DEVELOPER }),
      );
      repo.update.mockResolvedValue(
        sampleRow({ full_name: 'New', role: UserRole.DEVELOPER }),
      );
      await service.update(1, { fullName: 'New' }, 99);

      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('UPDATE');
      expect(entry.performedBy).toBe(99);
      expect(entry.metadata).toEqual({
        full_name: { from: 'Old', to: 'New' },
      });
      // role was not in the diff because it didn't change
      expect(entry.metadata).not.toHaveProperty('role');
    });
  });

  describe('delete', () => {
    it('404s when nothing was deleted (no audit)', async () => {
      repo.findById.mockResolvedValue(sampleRow());
      repo.delete.mockResolvedValue(false);
      await expect(service.delete(1, 99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('audits DELETE with username/role snapshot from BEFORE deletion', async () => {
      repo.findById.mockResolvedValue(
        sampleRow({ username: 'gone', role: UserRole.ADMIN }),
      );
      repo.delete.mockResolvedValue(true);
      await service.delete(1, 99);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('DELETE');
      expect(entry.performedBy).toBe(99);
      expect(entry.metadata).toEqual({
        username: 'gone',
        role: UserRole.ADMIN,
      });
    });
  });
});