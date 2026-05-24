import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { TicketPriority } from '../tickets/entities/ticket-priority.enum';
import { TicketStatus } from '../tickets/entities/ticket-status.enum';
import { TicketType } from '../tickets/entities/ticket-type.enum';
import { TicketRow } from '../tickets/entities/ticket.entity';
import { TicketsRepository } from '../tickets/tickets.repository';
import { EscalationService } from './escalation.service';

describe('EscalationService', () => {
  let service: EscalationService;
  let repo: jest.Mocked<TicketsRepository>;
  let audit: jest.Mocked<AuditService>;

  const overdue = (
    id: number,
    priority: TicketPriority,
    isOverdue = false,
  ): TicketRow => ({
    id,
    title: `T${id}`,
    description: null,
    status: TicketStatus.TODO,
    priority,
    type: TicketType.BUG,
    project_id: 1,
    assignee_id: null,
    // a dueDate in the past
    due_date: new Date(Date.now() - 86_400_000),
    is_overdue: isOverdue,
    version: 1,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  });

  beforeEach(async () => {
    const repoMock = {
      findOverdueUnresolved: jest.fn(),
      applyEscalation: jest.fn(),
    } as unknown as jest.Mocked<TicketsRepository>;
    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: TicketsRepository, useValue: repoMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get(EscalationService);
    repo = module.get(TicketsRepository);
    audit = module.get(AuditService);
  });

  it('does nothing when there are no overdue tickets', async () => {
    repo.findOverdueUnresolved.mockResolvedValue([]);
    const summary = await service.runOnce();
    expect(summary).toEqual({
      scanned: 0,
      promoted: 0,
      markedOverdue: 0,
      skipped: 0,
    });
    expect(repo.applyEscalation).not.toHaveBeenCalled();
  });

  it('promotes a LOW ticket one level to MEDIUM', async () => {
    repo.findOverdueUnresolved.mockResolvedValue([
      overdue(1, TicketPriority.LOW),
    ]);
    repo.applyEscalation.mockResolvedValue(overdue(1, TicketPriority.MEDIUM));
    const summary = await service.runOnce();

    expect(summary.promoted).toBe(1);
    expect(repo.applyEscalation).toHaveBeenCalledWith(1, {
      kind: 'promote',
      newPriority: TicketPriority.MEDIUM,
    });
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('PRIORITY_ESCALATED');
    expect(entry.actor).toBe('SYSTEM');
    expect(entry.performedBy).toBeNull();
    expect(entry.metadata).toMatchObject({
      priority: { from: 'LOW', to: 'MEDIUM' },
    });
  });

  it('promotes HIGH → CRITICAL', async () => {
    repo.findOverdueUnresolved.mockResolvedValue([
      overdue(1, TicketPriority.HIGH),
    ]);
    repo.applyEscalation.mockResolvedValue(overdue(1, TicketPriority.CRITICAL));
    const summary = await service.runOnce();
    expect(summary.promoted).toBe(1);
    expect(repo.applyEscalation).toHaveBeenCalledWith(1, {
      kind: 'promote',
      newPriority: TicketPriority.CRITICAL,
    });
  });

  it('marks a CRITICAL overdue ticket as is_overdue (not promoted further)', async () => {
    repo.findOverdueUnresolved.mockResolvedValue([
      overdue(1, TicketPriority.CRITICAL, false),
    ]);
    repo.applyEscalation.mockResolvedValue(
      overdue(1, TicketPriority.CRITICAL, true),
    );
    const summary = await service.runOnce();

    expect(summary.promoted).toBe(0);
    expect(summary.markedOverdue).toBe(1);
    expect(repo.applyEscalation).toHaveBeenCalledWith(1, {
      kind: 'mark_overdue',
    });
    const entry = audit.log.mock.calls[0][0];
    expect(entry.metadata).toMatchObject({
      isOverdue: { from: false, to: true },
    });
  });

  it('is idempotent — a CRITICAL ticket already flagged is skipped', async () => {
    repo.findOverdueUnresolved.mockResolvedValue([
      overdue(1, TicketPriority.CRITICAL, true), // already flagged
    ]);
    const summary = await service.runOnce();
    expect(summary.promoted).toBe(0);
    expect(summary.markedOverdue).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(repo.applyEscalation).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('counts a ticket as skipped when applyEscalation returns null (resolved mid-cycle)', async () => {
    repo.findOverdueUnresolved.mockResolvedValue([
      overdue(1, TicketPriority.LOW),
    ]);
    repo.applyEscalation.mockResolvedValue(null); // ticket vanished
    const summary = await service.runOnce();
    expect(summary.promoted).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('handles a mixed batch', async () => {
    repo.findOverdueUnresolved.mockResolvedValue([
      overdue(1, TicketPriority.LOW),
      overdue(2, TicketPriority.CRITICAL, false),
      overdue(3, TicketPriority.CRITICAL, true),
    ]);
    repo.applyEscalation.mockImplementation(async (id, change) => {
      if (change.kind === 'promote') {
        return overdue(id, change.newPriority);
      }
      return overdue(id, TicketPriority.CRITICAL, true);
    });
    const summary = await service.runOnce();
    expect(summary).toEqual({
      scanned: 3,
      promoted: 1, // ticket 1
      markedOverdue: 1, // ticket 2
      skipped: 1, // ticket 3 already flagged
    });
  });
});
