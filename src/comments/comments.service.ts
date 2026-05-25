import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-action.enum';
import { AuditActor } from '../audit/entities/audit-actor.enum';
import { AuditEntity } from '../audit/entities/audit-entity.enum';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';
import { CommentsRepository } from './comments.repository';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import {
  CommentResponse,
  CommentRow,
  PaginatedMentions,
  toCommentResponse,
} from './entities/comment.entity';
import { parseMentions } from './mention-parser';

/**
 * Comments business logic (§2.5 + §3.6 mentions).
 *
 * §3.6 mention handling:
 *   - @username matching is CASE-INSENSITIVE (parser lower-cases; the
 *     repository uses `LOWER(username) = ANY(...)`).
 *   - Unknown usernames are silently dropped — typo'd mention doesn't
 *     fail the comment.
 *
 * Transactional safety:
 *   - createWithMentions inserts comment + mention rows + AUDIT row in
 *     a single transaction. Phase 6 adds the audit write inside the same
 *     transaction (via AuditService.logWithClient) so a partial failure
 *     never leaves an audit entry without its comment or vice versa.
 *
 *   - updateContentAndMentions wipes & re-inserts mentions in the same
 *     transaction as the UPDATE.
 *
 * Optimistic locking on update mirrors TicketsService.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly comments: CommentsRepository,
    private readonly tickets: TicketsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lists all comments on a ticket, each with its resolved `mentionedUsers`
   * array (§3.6). Validates the ticket exists (404 otherwise). Backs
   * GET /tickets/:ticketId/comments.
   */
  async findByTicket(ticketId: number): Promise<CommentResponse[]> {
    await this.tickets.assertExistsAndGet(ticketId);
    const rows = await this.comments.findByTicket(ticketId);
    return this.attachMentions(rows);
  }

  /**
   * Adds a comment to a ticket. Parses `@username` mentions from the
   * content and resolves them to user ids (§3.6) — unknown names are
   * silently ignored. The comment row, its mention rows, and the audit
   * entry are written in one transaction. Returns the comment with its
   * `mentionedUsers` populated.
   */
  async create(
    ticketId: number,
    dto: CreateCommentDto,
    performedBy: number,
  ): Promise<CommentResponse> {
    await this.tickets.assertExistsAndGet(ticketId);
    await this.users.findById(dto.authorId);

    const mentionedUserIds = await this.resolveMentions(dto.content);

    // Phase 6: do the audit write inside the same transaction as the
    // comment + mentions inserts. A failure of any of the three rolls
    // back the others. Uses the transactional API so audit failure
    // PROPAGATES (unlike the fire-and-forget log() variant).
    const row = await this.comments.createWithMentions(
      {
        ticketId,
        authorId: dto.authorId,
        content: dto.content,
        mentionedUserIds,
      },
      async (client, comment) => {
        await this.audit.logWithClient(client, {
          action: AuditAction.CREATE,
          entityType: AuditEntity.COMMENT,
          entityId: Number(comment.id),
          performedBy,
          actor: AuditActor.USER,
          metadata: {
            ticketId,
            authorId: dto.authorId,
            mentionedUserIds,
          },
        });
      },
    );
    return this.toResponse(row);
  }

  /**
   * Edits a comment's content. Uses optimistic locking via `version` (§2.5
   * "two users can't edit a comment at once") — a stale version is a 409.
   * Re-parses @mentions from the new content and replaces the mention rows
   * (§3.6 re-evaluation on update). 404 if the comment doesn't belong to
   * the given ticket.
   */
  async update(
    ticketId: number,
    commentId: number,
    dto: UpdateCommentDto,
    performedBy: number,
  ): Promise<CommentResponse> {
    if (dto.version === undefined) {
      throw new BadRequestException(
        '"version" is required for concurrency control. Send the value from the most recent comment response.',
      );
    }
    const existing = await this.getOrThrow(commentId);
    if (Number(existing.ticket_id) !== ticketId) {
      throw new NotFoundException(
        `Comment ${commentId} not found on ticket ${ticketId}`,
      );
    }

    const mentionedUserIds = await this.resolveMentions(dto.content);

    const updated = await this.comments.updateContentAndMentions(
      commentId,
      dto.version,
      dto.content,
      mentionedUserIds,
      async (client) => {
        await this.audit.logWithClient(client, {
          action: AuditAction.UPDATE,
          entityType: AuditEntity.COMMENT,
          entityId: commentId,
          performedBy,
          actor: AuditActor.USER,
          metadata: {
            contentChanged: existing.content !== dto.content,
            previousMentionsReplaced: true,
            newMentionedUserIds: mentionedUserIds,
          },
        });
      },
    );
    if (!updated) {
      const live = await this.comments.findById(commentId);
      const liveVersion = live?.version ?? '?';
      throw new ConflictException(
        `Comment ${commentId} was modified by another writer. Expected version ${dto.version}, current is ${liveVersion}. Please reload and retry.`,
      );
    }
    return this.toResponse(updated);
  }

  /**
   * Hard-deletes a comment (comments are not soft-deleted). 404 if the
   * comment doesn't exist or doesn't belong to the given ticket. Records a
   * DELETE audit entry.
   */
  async delete(
    ticketId: number,
    commentId: number,
    performedBy: number,
  ): Promise<void> {
    const existing = await this.getOrThrow(commentId);
    if (Number(existing.ticket_id) !== ticketId) {
      throw new NotFoundException(
        `Comment ${commentId} not found on ticket ${ticketId}`,
      );
    }
    await this.comments.delete(commentId);

    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: AuditEntity.COMMENT,
      entityId: commentId,
      performedBy,
      actor: AuditActor.USER,
      metadata: {
        ticketId,
        authorId: Number(existing.author_id),
      },
    });
  }

  /**
   * §3.6: GET /users/:userId/mentions — newest first, paginated.
   */
  async findMentionsForUser(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<PaginatedMentions> {
    await this.users.findById(userId);
    const { rows, total } = await this.comments.findCommentsMentioning(
      userId,
      page,
      pageSize,
    );
    const data = await this.attachMentions(rows);
    return { data, total, page };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async resolveMentions(content: string): Promise<number[]> {
    const usernames = parseMentions(content);
    if (usernames.length === 0) return [];
    const users = await this.users.findRawByUsernamesLower(usernames);
    const ids = new Set<number>();
    for (const u of users) ids.add(Number(u.id));
    return Array.from(ids);
  }

  private async attachMentions(rows: CommentRow[]): Promise<CommentResponse[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => Number(r.id));
    const map = await this.comments.findMentionedUsersForComments(ids);
    return rows.map((r) => toCommentResponse(r, map.get(Number(r.id)) ?? []));
  }

  private async toResponse(row: CommentRow): Promise<CommentResponse> {
    const mentions = await this.comments.findMentionedUsers(Number(row.id));
    return toCommentResponse(row, mentions);
  }

  private async getOrThrow(id: number): Promise<CommentRow> {
    const row = await this.comments.findById(id);
    if (!row) {
      throw new NotFoundException(`Comment ${id} not found`);
    }
    return row;
  }
}