import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../../audit/audit.service';
import { ProjectsService } from '../../projects/projects.service';
import { TicketPriority } from '../entities/ticket-priority.enum';
import { TicketStatus } from '../entities/ticket-status.enum';
import { TicketType } from '../entities/ticket-type.enum';
import { TicketRow } from '../entities/ticket.entity';
import { TicketsRepository } from '../tickets.repository';
import { CsvExportService } from './csv-export.service';
import { CsvImportService } from './csv-import.service';

/**
 * Unit tests for the CSV export and import services (§3.4).
 *
 * What: exporting a project's tickets to CSV text, and importing
 * tickets in bulk from a CSV buffer.
 * How: the tickets/projects repositories and AuditService are mocked;
 * tests feed in ticket rows / CSV strings and assert on the output.
 * Expected: the export header is exactly
 * id,title,description,status,priority,type,assigneeId, and values
 * containing commas/quotes are RFC-4180 quoted; the import returns a
 * { created, failed, errors } summary, collecting per-row errors
 * instead of aborting the whole batch.
 */

const ticketRow = (overrides: Partial<TicketRow> = {}): TicketRow => ({
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

describe('CsvExportService', () => {
  let service: CsvExportService;
  let repo: jest.Mocked<TicketsRepository>;

  beforeEach(async () => {
    const repoMock = {
      findByProject: jest.fn(),
    } as unknown as jest.Mocked<TicketsRepository>;
    const projectsMock = {
      assertExists: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProjectsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvExportService,
        { provide: TicketsRepository, useValue: repoMock },
        { provide: ProjectsService, useValue: projectsMock },
      ],
    }).compile();

    service = module.get(CsvExportService);
    repo = module.get(TicketsRepository);
  });

  it('emits a header row plus one row per ticket', async () => {
    repo.findByProject.mockResolvedValue([
      ticketRow({ id: 1, title: 'A' }),
      ticketRow({ id: 2, title: 'B' }),
    ]);
    const csv = await service.exportProject(1);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'id,title,description,status,priority,type,assigneeId',
    );
    expect(lines).toHaveLength(3); // header + 2
  });

  it('quotes fields containing commas and quotes (RFC 4180)', async () => {
    repo.findByProject.mockResolvedValue([
      ticketRow({
        id: 1,
        title: 'Title, with comma',
        description: 'has "quotes" inside',
      }),
    ]);
    const csv = await service.exportProject(1);
    // comma-bearing field is wrapped in quotes
    expect(csv).toContain('"Title, with comma"');
    // embedded quotes are doubled
    expect(csv).toContain('"has ""quotes"" inside"');
  });

  it('renders an unassigned ticket with a blank assigneeId', async () => {
    repo.findByProject.mockResolvedValue([
      ticketRow({ id: 1, assignee_id: null }),
    ]);
    const csv = await service.exportProject(1);
    const dataLine = csv.trim().split('\n')[1];
    // last field (assigneeId) is empty
    expect(dataLine.endsWith(',')).toBe(true);
  });
});

describe('CsvImportService', () => {
  let service: CsvImportService;
  let repo: jest.Mocked<TicketsRepository>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const repoMock = {
      create: jest.fn().mockResolvedValue(ticketRow()),
    } as unknown as jest.Mocked<TicketsRepository>;
    const projectsMock = {
      assertExists: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ProjectsService>;
    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvImportService,
        { provide: TicketsRepository, useValue: repoMock },
        { provide: ProjectsService, useValue: projectsMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get(CsvImportService);
    repo = module.get(TicketsRepository);
    audit = module.get(AuditService);
  });

  it('imports every valid row', async () => {
    const csv = [
      'title,description,status,priority,type,assigneeId',
      'First bug,desc one,TODO,HIGH,BUG,',
      'Second bug,desc two,IN_PROGRESS,LOW,FEATURE,',
    ].join('\n');
    const summary = await service.importIntoProject(1, Buffer.from(csv), 99);
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(0);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it('collects per-row errors without aborting the batch', async () => {
    const csv = [
      'title,description,status,priority,type,assigneeId',
      'Good one,,TODO,HIGH,BUG,',
      ',missing title,,,BUG,', // invalid: blank title
      'Bad type,,,,NONSENSE,', // invalid: bad type
      'Another good,,,,TECHNICAL,',
    ].join('\n');
    const summary = await service.importIntoProject(1, Buffer.from(csv), 99);
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(2);
    expect(summary.errors).toHaveLength(2);
    // row indices are 1-based, header excluded
    expect(summary.errors[0].row).toBe(2);
    expect(summary.errors[0].message).toMatch(/title/);
    expect(summary.errors[1].row).toBe(3);
    expect(summary.errors[1].message).toMatch(/type/);
  });

  it('handles quoted fields with embedded commas', async () => {
    const csv = [
      'title,description,status,priority,type,assigneeId',
      '"Title, with comma","Description, also comma",TODO,LOW,BUG,',
    ].join('\n');
    const summary = await service.importIntoProject(1, Buffer.from(csv), 99);
    expect(summary.created).toBe(1);
    const createArg = repo.create.mock.calls[0][0];
    expect(createArg.title).toBe('Title, with comma');
    expect(createArg.description).toBe('Description, also comma');
  });

  it('defaults blank status/priority to undefined (DB defaults apply)', async () => {
    const csv = [
      'title,description,status,priority,type,assigneeId',
      'Minimal,,,,BUG,',
    ].join('\n');
    await service.importIntoProject(1, Buffer.from(csv), 99);
    const createArg = repo.create.mock.calls[0][0];
    expect(createArg.status).toBeUndefined();
    expect(createArg.priority).toBeUndefined();
  });

  it('400s on a completely unparseable file', async () => {
    // A buffer that csv-parse rejects: unterminated quote.
    const bad = Buffer.from('title\n"unterminated');
    await expect(service.importIntoProject(1, bad, 99)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('writes one summary audit entry for the whole import', async () => {
    const csv = [
      'title,description,status,priority,type,assigneeId',
      'One,,,,BUG,',
    ].join('\n');
    await service.importIntoProject(1, Buffer.from(csv), 99);
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.metadata).toMatchObject({ operation: 'csv-import' });
  });
});
