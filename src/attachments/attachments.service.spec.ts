import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs/promises';
import { AuditService } from '../audit/audit.service';
import { TicketsService } from '../tickets/tickets.service';
import { AttachmentsRepository } from './attachments.repository';
import { AttachmentsService } from './attachments.service';
import { AttachmentRow } from './entities/attachment.entity';

/**
 * Unit tests for AttachmentsService. fs is mocked so no real files are
 * written; the repository, TicketsService, AuditService and ConfigService
 * are all mocked too.
 */
jest.mock('fs/promises');

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let repo: jest.Mocked<AttachmentsRepository>;
  let tickets: jest.Mocked<TicketsService>;
  let audit: jest.Mocked<AuditService>;

  const sampleRow = (
    overrides: Partial<AttachmentRow> = {},
  ): AttachmentRow => ({
    id: 1,
    ticket_id: 1,
    uploader_id: 1,
    filename: 'screenshot.png',
    content_type: 'image/png',
    byte_size: 1024,
    storage_key: 'uuid-key.png',
    created_at: new Date(),
    ...overrides,
  });

  const makeFile = (
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File =>
    ({
      fieldname: 'file',
      originalname: 'screenshot.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from('fake-bytes'),
      destination: '',
      filename: '',
      path: '',
      stream: undefined as never,
      ...overrides,
    }) as Express.Multer.File;

  beforeEach(async () => {
    jest.clearAllMocks();
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    const repoMock = {
      create: jest.fn(),
      findById: jest.fn(),
      findByTicket: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<AttachmentsRepository>;
    const ticketsMock = {
      assertExistsAndGet: jest.fn().mockResolvedValue({} as never),
    } as unknown as jest.Mocked<TicketsService>;
    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;
    const configMock = {
      get: jest.fn().mockReturnValue('./test-uploads'),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: AttachmentsRepository, useValue: repoMock },
        { provide: TicketsService, useValue: ticketsMock },
        { provide: AuditService, useValue: auditMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get(AttachmentsService);
    repo = module.get(AttachmentsRepository);
    tickets = module.get(TicketsService);
    audit = module.get(AuditService);
  });

  describe('upload', () => {
    it('400s when no file is provided', async () => {
      await expect(service.upload(1, undefined, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects files over the 10 MB limit', async () => {
      const big = makeFile({ size: AttachmentsService.MAX_BYTES + 1 });
      await expect(service.upload(1, big, 1)).rejects.toThrow(/10 MB/);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects disallowed MIME types', async () => {
      const exe = makeFile({
        originalname: 'virus.exe',
        mimetype: 'application/x-msdownload',
      });
      await expect(service.upload(1, exe, 1)).rejects.toThrow(
        /Unsupported file type/,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each(['image/png', 'image/jpeg', 'application/pdf', 'text/plain'])(
      'accepts allowed MIME type %s',
      async (mime) => {
        repo.create.mockResolvedValue(sampleRow({ content_type: mime }));
        const result = await service.upload(1, makeFile({ mimetype: mime }), 1);
        expect(result.contentType).toBe(mime);
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
      },
    );

    it('404s when the ticket does not exist', async () => {
      tickets.assertExistsAndGet.mockRejectedValueOnce(
        new NotFoundException('no ticket'),
      );
      await expect(service.upload(99, makeFile(), 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('persists metadata and audits on success', async () => {
      repo.create.mockResolvedValue(sampleRow({ id: 7 }));
      const result = await service.upload(1, makeFile(), 42);
      expect(result.id).toBe(7);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('CREATE');
      expect(entry.entityType).toBe('ATTACHMENT');
      expect(entry.performedBy).toBe(42);
    });

    it('cleans up the disk file if the metadata insert fails', async () => {
      repo.create.mockRejectedValueOnce(new Error('db error'));
      await expect(service.upload(1, makeFile(), 1)).rejects.toThrow(
        /db error/,
      );
      // the orphan file must have been removed
      expect(fs.rm).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('404s when the attachment does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.delete(1, 99, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the attachment belongs to a different ticket', async () => {
      repo.findById.mockResolvedValue(sampleRow({ id: 5, ticket_id: 8 }));
      await expect(service.delete(1, 5, 1)).rejects.toThrow(
        /not found on ticket 1/,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('deletes the row + file and audits', async () => {
      repo.findById.mockResolvedValue(sampleRow({ id: 5, ticket_id: 1 }));
      repo.delete.mockResolvedValue(true);
      await service.delete(1, 5, 42);
      expect(repo.delete).toHaveBeenCalledWith(5);
      expect(fs.rm).toHaveBeenCalled();
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('DELETE');
      expect(entry.entityType).toBe('ATTACHMENT');
    });
  });
});
