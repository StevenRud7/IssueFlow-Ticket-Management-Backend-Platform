import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { TicketsService } from '../tickets/tickets.service';
import { UserRole } from '../users/entities/user-role.enum';
import { UserRow } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentRow } from './entities/comment.entity';

describe('CommentsService', () => {
  let service: CommentsService;
  let repo: jest.Mocked<CommentsRepository>;
  let tickets: jest.Mocked<TicketsService>;
  let users: jest.Mocked<UsersService>;
  let audit: jest.Mocked<AuditService>;

  const sampleComment = (overrides: Partial<CommentRow> = {}): CommentRow => ({
    id: 1,
    ticket_id: 1,
    author_id: 1,
    content: 'hello',
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  const sampleUser = (overrides: Partial<UserRow> = {}): UserRow => ({
    id: 1,
    username: 'jdoe',
    email: 'j@example.com',
    full_name: 'John Doe',
    role: UserRole.DEVELOPER,
    password_hash: 'x',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const repoMock = {
      findById: jest.fn(),
      findByTicket: jest.fn(),
      findMentionedUsers: jest.fn().mockResolvedValue([]),
      findMentionedUsersForComments: jest.fn().mockResolvedValue(new Map()),
      createWithMentions: jest.fn(),
      updateContentAndMentions: jest.fn(),
      delete: jest.fn(),
      findCommentsMentioning: jest.fn(),
    } as unknown as jest.Mocked<CommentsRepository>;

    const ticketsMock = {
      assertExistsAndGet: jest.fn().mockResolvedValue({} as never),
    } as unknown as jest.Mocked<TicketsService>;

    const usersMock = {
      findById: jest.fn().mockResolvedValue({} as never),
      findRawByUsernamesLower: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<UsersService>;

    const auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithClient: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: CommentsRepository, useValue: repoMock },
        { provide: TicketsService, useValue: ticketsMock },
        { provide: UsersService, useValue: usersMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get(CommentsService);
    repo = module.get(CommentsRepository);
    tickets = module.get(TicketsService);
    users = module.get(UsersService);
    audit = module.get(AuditService);
  });

  describe('create', () => {
    it('validates the parent ticket', async () => {
      tickets.assertExistsAndGet.mockRejectedValueOnce(
        new NotFoundException('no ticket'),
      );
      await expect(
        service.create(99, { authorId: 1, content: 'hi' }, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.createWithMentions).not.toHaveBeenCalled();
    });

    it('validates the author', async () => {
      users.findById.mockRejectedValueOnce(new NotFoundException('no author'));
      await expect(
        service.create(1, { authorId: 999, content: 'hi' }, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('parses mentions, resolves users, persists mention rows', async () => {
      users.findRawByUsernamesLower.mockResolvedValue([
        sampleUser({ id: 2, username: 'alice' }),
        sampleUser({ id: 3, username: 'bob' }),
      ]);
      repo.createWithMentions.mockResolvedValue(
        sampleComment({ content: 'hey @Alice and @bob' }),
      );
      await service.create(
        1,
        { authorId: 1, content: 'hey @Alice and @bob' },
        99,
      );
      expect(users.findRawByUsernamesLower).toHaveBeenCalledWith([
        'alice',
        'bob',
      ]);
      const args = repo.createWithMentions.mock.calls[0][0];
      expect(args.mentionedUserIds).toEqual([2, 3]);
    });

    it('passes an onCommitting callback that emits a transactional audit', async () => {
      users.findRawByUsernamesLower.mockResolvedValue([]);
      repo.createWithMentions.mockImplementation(
        async (_input, onCommitting) => {
          // Pretend the transaction reached commit-time and called us
          if (onCommitting) {
            await onCommitting({} as never, sampleComment({ id: 7 }));
          }
          return sampleComment({ id: 7 });
        },
      );
      await service.create(1, { authorId: 1, content: 'hi' }, 42);
      expect(audit.logWithClient).toHaveBeenCalledTimes(1);
      const entry = audit.logWithClient.mock.calls[0][1];
      expect(entry.action).toBe('CREATE');
      expect(entry.entityType).toBe('COMMENT');
      expect(entry.entityId).toBe(7);
      expect(entry.performedBy).toBe(42);
    });

    it('silently drops unknown usernames', async () => {
      users.findRawByUsernamesLower.mockResolvedValue([
        sampleUser({ id: 2, username: 'alice' }),
      ]);
      repo.createWithMentions.mockResolvedValue(sampleComment());
      await service.create(
        1,
        { authorId: 1, content: 'hey @alice and @ghost' },
        1,
      );
      const args = repo.createWithMentions.mock.calls[0][0];
      expect(args.mentionedUserIds).toEqual([2]);
    });
  });

  describe('update', () => {
    it('400s when version is missing', async () => {
      await expect(
        service.update(1, 1, { content: 'new' }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when the comment is on a different ticket', async () => {
      repo.findById.mockResolvedValue(sampleComment({ id: 1, ticket_id: 5 }));
      await expect(
        service.update(99, 1, { content: 'new', version: 1 }, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.updateContentAndMentions).not.toHaveBeenCalled();
    });

    it('409s on stale version', async () => {
      repo.findById
        .mockResolvedValueOnce(
          sampleComment({ id: 1, ticket_id: 1, version: 5 }),
        )
        .mockResolvedValueOnce(
          sampleComment({ id: 1, ticket_id: 1, version: 7 }),
        );
      repo.updateContentAndMentions.mockResolvedValue(null);
      await expect(
        service.update(1, 1, { content: 'new', version: 5 }, 1),
      ).rejects.toThrow(/Expected version 5, current is 7/);
    });

    it('happy path returns updated comment with new mentions', async () => {
      repo.findById.mockResolvedValueOnce(
        sampleComment({ id: 1, ticket_id: 1, version: 1 }),
      );
      users.findRawByUsernamesLower.mockResolvedValue([
        sampleUser({ id: 9, username: 'carol' }),
      ]);
      repo.updateContentAndMentions.mockResolvedValue(
        sampleComment({
          id: 1,
          ticket_id: 1,
          version: 2,
          content: 'hi @carol',
        }),
      );
      repo.findMentionedUsers.mockResolvedValue([
        { id: 9, username: 'carol', full_name: 'Carol' },
      ]);

      const result = await service.update(
        1,
        1,
        { content: 'hi @carol', version: 1 },
        1,
      );
      expect(result.version).toBe(2);
      expect(result.mentionedUsers).toEqual([
        { id: 9, username: 'carol', fullName: 'Carol' },
      ]);
    });
  });

  describe('delete', () => {
    it('404s when comment does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.delete(1, 99, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when comment is on a different ticket', async () => {
      repo.findById.mockResolvedValue(sampleComment({ id: 99, ticket_id: 5 }));
      await expect(service.delete(1, 99, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('audits DELETE on success', async () => {
      repo.findById.mockResolvedValue(
        sampleComment({ id: 1, ticket_id: 1, author_id: 5 }),
      );
      repo.delete.mockResolvedValue(true);
      await service.delete(1, 1, 42);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('DELETE');
      expect(entry.entityType).toBe('COMMENT');
      expect(entry.performedBy).toBe(42);
    });
  });

  describe('findMentionsForUser', () => {
    it('validates the user exists', async () => {
      users.findById.mockRejectedValueOnce(new NotFoundException('no user'));
      await expect(
        service.findMentionsForUser(999, 1, 20),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns paginated envelope', async () => {
      repo.findCommentsMentioning.mockResolvedValue({
        rows: [sampleComment({ id: 1 })],
        total: 1,
      });
      const result = await service.findMentionsForUser(1, 1, 20);
      expect(result.page).toBe(1);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });
});
