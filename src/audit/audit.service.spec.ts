import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { AuditAction } from './entities/audit-action.enum';
import { AuditActor } from './entities/audit-actor.enum';
import { AuditEntity } from './entities/audit-entity.enum';

describe('AuditService', () => {
  let service: AuditService;
  let repo: jest.Mocked<AuditRepository>;

  beforeEach(async () => {
    const repoMock = {
      insert: jest.fn().mockResolvedValue(undefined),
      insertWithClient: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: AuditRepository, useValue: repoMock },
      ],
    }).compile();

    service = module.get(AuditService);
    repo = module.get(AuditRepository);
  });

  describe('log (fire-and-forget)', () => {
    it('forwards the insert', async () => {
      await service.log({
        action: AuditAction.CREATE,
        entityType: AuditEntity.TICKET,
        entityId: 5,
        performedBy: 1,
        actor: AuditActor.USER,
      });
      expect(repo.insert).toHaveBeenCalledTimes(1);
    });

    it('swallows insert failures so business writes are not rolled back', async () => {
      repo.insert.mockRejectedValueOnce(new Error('db down'));
      // The service logs the failure via Logger.error before swallowing it.
      // That log line is expected behaviour, but it's noise in the test
      // output — silence it so a green run stays quiet. We also assert the
      // error WAS logged, which is part of the contract.
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      // Must not throw — audit failure should NOT cascade.
      await expect(
        service.log({
          action: AuditAction.UPDATE,
          entityType: AuditEntity.TICKET,
          entityId: 5,
          performedBy: 1,
          actor: AuditActor.USER,
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });
  });

  describe('logWithClient (transactional)', () => {
    it('forwards to the repo with the supplied client', async () => {
      const fakeClient = { query: jest.fn() } as unknown as Parameters<
        typeof service.logWithClient
      >[0];
      await service.logWithClient(fakeClient, {
        action: AuditAction.CREATE,
        entityType: AuditEntity.COMMENT,
        entityId: 7,
        performedBy: 1,
        actor: AuditActor.USER,
      });
      expect(repo.insertWithClient).toHaveBeenCalledTimes(1);
      expect(repo.insertWithClient.mock.calls[0][0]).toBe(fakeClient);
    });

    it('PROPAGATES errors (unlike fire-and-forget log)', async () => {
      repo.insertWithClient.mockRejectedValueOnce(new Error('insert failed'));
      const fakeClient = {} as Parameters<typeof service.logWithClient>[0];
      await expect(
        service.logWithClient(fakeClient, {
          action: AuditAction.CREATE,
          entityType: AuditEntity.COMMENT,
          entityId: 1,
          performedBy: 1,
          actor: AuditActor.USER,
        }),
      ).rejects.toThrow(/insert failed/);
    });
  });

  describe('find', () => {
    it('returns a plain array (README contract), newest-first from repo', async () => {
      repo.find.mockResolvedValue([]);
      const result = await service.find({});
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });

    it('passes through all four filters to the repository', async () => {
      repo.find.mockResolvedValue([]);
      await service.find({
        entityType: AuditEntity.TICKET,
        entityId: 5,
        action: AuditAction.UPDATE,
        actor: AuditActor.SYSTEM,
      });
      const args = repo.find.mock.calls[0][0];
      expect(args.entityType).toBe(AuditEntity.TICKET);
      expect(args.entityId).toBe(5);
      expect(args.action).toBe(AuditAction.UPDATE);
      expect(args.actor).toBe(AuditActor.SYSTEM);
      // no pagination params in the contract
      expect(args).not.toHaveProperty('page');
      expect(args).not.toHaveProperty('pageSize');
    });

    it('maps repository rows to the audit-log response shape', async () => {
      const row = {
        id: 7,
        action: AuditAction.CREATE,
        entity_type: AuditEntity.TICKET,
        entity_id: 3,
        performed_by: 2,
        actor: AuditActor.USER,
        metadata: {},
        timestamp: new Date('2026-03-01T10:00:00Z'),
      };
      repo.find.mockResolvedValue([row]);
      const result = await service.find({});
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 7,
        action: AuditAction.CREATE,
        entityType: AuditEntity.TICKET,
        entityId: 3,
        performedBy: 2,
        actor: AuditActor.USER,
      });
    });
  });
});