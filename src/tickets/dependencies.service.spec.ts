import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { DependenciesRepository } from './dependencies.repository';
import { DependenciesService } from './dependencies.service';
import { TicketPriority } from './entities/ticket-priority.enum';
import { TicketStatus } from './entities/ticket-status.enum';
import { TicketType } from './entities/ticket-type.enum';
import { TicketRow } from './entities/ticket.entity';
import { TicketsRepository } from './tickets.repository';

describe('DependenciesService', () => {
  let service: DependenciesService;
  let deps: jest.Mocked<DependenciesRepository>;
  let tickets: jest.Mocked<TicketsRepository>;
  let audit: jest.Mocked<AuditService>;

  const ticket = (
    id: number,
    projectId = 1,
    overrides: Partial<TicketRow> = {},
  ): TicketRow => ({
    id,
    title: `T${id}`,
    description: null,
    status: TicketStatus.TODO,
    priority: TicketPriority.MEDIUM,
    type: TicketType.BUG,
    project_id: projectId,
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
    const depsMock = {
      add: jest.fn().mockResolvedValue(true),
      remove: jest.fn(),
      listBlockers: jest.fn(),
      blockerIdsOf: jest.fn().mockResolvedValue([]),
      countUnresolvedBlockers: jest.fn(),
    } as unknown as jest.Mocked<DependenciesRepository>;
    const ticketsMock = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<TicketsRepository>;
    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DependenciesService,
        { provide: DependenciesRepository, useValue: depsMock },
        { provide: TicketsRepository, useValue: ticketsMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get(DependenciesService);
    deps = module.get(DependenciesRepository);
    tickets = module.get(TicketsRepository);
    audit = module.get(AuditService);
  });

  describe('add', () => {
    it('rejects self-dependency', async () => {
      await expect(service.add(5, 5, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(deps.add).not.toHaveBeenCalled();
    });

    it('404s when the ticket does not exist', async () => {
      tickets.findById.mockResolvedValueOnce(null);
      await expect(service.add(1, 2, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the blocker does not exist', async () => {
      tickets.findById
        .mockResolvedValueOnce(ticket(1))
        .mockResolvedValueOnce(null);
      await expect(service.add(1, 2, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects cross-project dependencies', async () => {
      tickets.findById
        .mockResolvedValueOnce(ticket(1, 1))
        .mockResolvedValueOnce(ticket(2, 2)); // different project
      await expect(service.add(1, 2, 1)).rejects.toThrow(/same project/);
      expect(deps.add).not.toHaveBeenCalled();
    });

    it('rejects a dependency that would create a cycle', async () => {
      // ticket 1 and ticket 2 both in project 1.
      tickets.findById
        .mockResolvedValueOnce(ticket(1, 1))
        .mockResolvedValueOnce(ticket(2, 1));
      // Existing graph: ticket 2 is already blocked by ticket 1.
      // Adding "1 blocked by 2" would close a loop 1→2→1.
      deps.blockerIdsOf.mockImplementation(async (id: number) =>
        id === 2 ? [1] : [],
      );
      await expect(service.add(1, 2, 1)).rejects.toThrow(/cycle/);
      expect(deps.add).not.toHaveBeenCalled();
    });

    it('adds a valid dependency and audits it', async () => {
      tickets.findById
        .mockResolvedValueOnce(ticket(1, 1))
        .mockResolvedValueOnce(ticket(2, 1));
      deps.blockerIdsOf.mockResolvedValue([]); // no cycle
      deps.add.mockResolvedValue(true);

      await service.add(1, 2, 99);

      expect(deps.add).toHaveBeenCalledWith(1, 2);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('CREATE');
      expect(entry.entityType).toBe('DEPENDENCY');
      expect(entry.performedBy).toBe(99);
      expect(entry.metadata).toMatchObject({ ticketId: 1, blockedBy: 2 });
    });

    it('does not audit when the edge already existed (idempotent add)', async () => {
      tickets.findById
        .mockResolvedValueOnce(ticket(1, 1))
        .mockResolvedValueOnce(ticket(2, 1));
      deps.blockerIdsOf.mockResolvedValue([]);
      deps.add.mockResolvedValue(false); // ON CONFLICT DO NOTHING
      await service.add(1, 2, 99);
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('404s when the dependency does not exist', async () => {
      deps.remove.mockResolvedValue(false);
      await expect(service.remove(1, 2, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('removes and audits', async () => {
      deps.remove.mockResolvedValue(true);
      await service.remove(1, 2, 99);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('DELETE');
      expect(entry.entityType).toBe('DEPENDENCY');
    });
  });

  describe('list', () => {
    it('404s when the ticket does not exist', async () => {
      tickets.findById.mockResolvedValue(null);
      await expect(service.list(99)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the blocker list', async () => {
      tickets.findById.mockResolvedValue(ticket(1));
      deps.listBlockers.mockResolvedValue([
        { id: 2, title: 'Blocker', status: TicketStatus.IN_PROGRESS },
      ]);
      const result = await service.list(1);
      expect(result).toEqual([
        { id: 2, title: 'Blocker', status: TicketStatus.IN_PROGRESS },
      ]);
    });
  });
});
