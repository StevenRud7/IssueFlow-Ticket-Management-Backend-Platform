import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { CommentRow, MentionedUserRow } from './entities/comment.entity';

/**
 * SQL for the `comments` and `comment_mentions` tables.
 *
 * The interesting methods are:
 *   - createWithMentions  — single transaction, inserts comment then
 *                            its mention rows. Either both succeed or
 *                            neither does.
 *   - replaceMentions     — used by update(): wipes the comment's mention
 *                            rows and re-inserts the new set. Idempotent.
 *   - findMentionsForUser — paginated, with total count. Newest first.
 *
 * `version` participates in optimistic locking the same way it does on
 * tickets — every UPDATE scopes by id AND version, then bumps it.
 */
@Injectable()
export class CommentsRepository {
  private static readonly COLUMNS = `
    id, ticket_id, author_id, content, version, created_at, updated_at
  `;

  constructor(private readonly db: DatabaseService) {}

  async findById(id: number): Promise<CommentRow | null> {
    const { rows } = await this.db.query<CommentRow>(
      `SELECT ${CommentsRepository.COLUMNS}
         FROM comments
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByTicket(ticketId: number): Promise<CommentRow[]> {
    const { rows } = await this.db.query<CommentRow>(
      `SELECT ${CommentsRepository.COLUMNS}
         FROM comments
        WHERE ticket_id = $1
        ORDER BY id ASC`,
      [ticketId],
    );
    return rows;
  }

  /**
   * Returns the mention rows for a single comment, joined to users so the
   * caller doesn't need a second lookup.
   */
  async findMentionedUsers(commentId: number): Promise<MentionedUserRow[]> {
    const { rows } = await this.db.query<MentionedUserRow>(
      `SELECT u.id, u.username, u.full_name
         FROM comment_mentions cm
         JOIN users u ON u.id = cm.mentioned_user_id
        WHERE cm.comment_id = $1
        ORDER BY u.id ASC`,
      [commentId],
    );
    return rows;
  }

  /**
   * Bulk variant for the list endpoint — fetches all mentions for a set
   * of comments in one query, returning them grouped by comment_id. Avoids
   * N+1 queries when rendering `GET /tickets/:id/comments`.
   */
  async findMentionedUsersForComments(
    commentIds: number[],
  ): Promise<Map<number, MentionedUserRow[]>> {
    const map = new Map<number, MentionedUserRow[]>();
    if (commentIds.length === 0) return map;

    const { rows } = await this.db.query<
      MentionedUserRow & { comment_id: number }
    >(
      `SELECT cm.comment_id, u.id, u.username, u.full_name
         FROM comment_mentions cm
         JOIN users u ON u.id = cm.mentioned_user_id
        WHERE cm.comment_id = ANY($1::bigint[])
        ORDER BY cm.comment_id, u.id`,
      [commentIds],
    );
    for (const r of rows) {
      const cid = Number(r.comment_id);
      const list = map.get(cid) ?? [];
      list.push({ id: r.id, username: r.username, full_name: r.full_name });
      map.set(cid, list);
    }
    return map;
  }

  /**
   * Insert comment + its mentions in one transaction. Returns the new
   * comment row; mention rows are written but not returned (the service
   * re-queries with findMentionedUsers to get them joined).
   *
   * `mentionedUserIds` is already de-duplicated by the service.
   *
   * `onCommitting` is an optional callback invoked AFTER the rows are
   * written but BEFORE the transaction commits. The same `client` is
   * passed in, so anything the callback does (e.g. an audit insert)
   * participates in the same transaction. If the callback throws, the
   * entire transaction rolls back — comment, mentions, and audit row
   * all gone. Phase 6 uses this to write the audit row atomically with
   * the comment.
   */
  async createWithMentions(
    input: {
      ticketId: number;
      authorId: number;
      content: string;
      mentionedUserIds: number[];
    },
    onCommitting?: (client: PoolClient, comment: CommentRow) => Promise<void>,
  ): Promise<CommentRow> {
    return this.db.transaction(async (client: PoolClient) => {
      const { rows } = await client.query<CommentRow>(
        `INSERT INTO comments (ticket_id, author_id, content)
              VALUES ($1, $2, $3)
           RETURNING ${CommentsRepository.COLUMNS}`,
        [input.ticketId, input.authorId, input.content],
      );
      const comment = rows[0];

      if (input.mentionedUserIds.length > 0) {
        // Multi-row INSERT in one statement. Build the values list
        // dynamically so we keep parameter binding (no SQL concatenation
        // of user ids).
        const placeholders = input.mentionedUserIds
          .map((_, i) => `($1, $${i + 2})`)
          .join(', ');
        await client.query(
          `INSERT INTO comment_mentions (comment_id, mentioned_user_id)
                VALUES ${placeholders}`,
          [comment.id, ...input.mentionedUserIds],
        );
      }
      if (onCommitting) {
        await onCommitting(client, comment);
      }
      return comment;
    });
  }

  /**
   * Optimistic-lock UPDATE on content + bump version + replace mentions.
   * Done in a transaction so any partial failure rolls back cleanly.
   *
   * Returns null when:
   *   - no row with that id, OR
   *   - the row exists but version moved on
   *
   * The service distinguishes these two cases by first checking the comment
   * exists, then if the UPDATE returns null it surfaces a clean 409 with
   * the live version.
   */
  async updateContentAndMentions(
    id: number,
    expectedVersion: number,
    content: string,
    mentionedUserIds: number[],
    onCommitting?: (client: PoolClient, updated: CommentRow) => Promise<void>,
  ): Promise<CommentRow | null> {
    return this.db.transaction(async (client: PoolClient) => {
      const { rows } = await client.query<CommentRow>(
        `UPDATE comments
            SET content = $1, version = version + 1
          WHERE id = $2 AND version = $3
          RETURNING ${CommentsRepository.COLUMNS}`,
        [content, id, expectedVersion],
      );
      const updated = rows[0];
      if (!updated) {
        // Don't touch comment_mentions — leave them in their pre-update
        // state. The transaction will roll back when we return null and
        // the service throws.
        return null;
      }

      // Replace mentions: wipe and re-insert. Simpler than computing a
      // diff and equally correct given mention counts are small.
      await client.query(`DELETE FROM comment_mentions WHERE comment_id = $1`, [
        id,
      ]);
      if (mentionedUserIds.length > 0) {
        const placeholders = mentionedUserIds
          .map((_, i) => `($1, $${i + 2})`)
          .join(', ');
        await client.query(
          `INSERT INTO comment_mentions (comment_id, mentioned_user_id)
                VALUES ${placeholders}`,
          [id, ...mentionedUserIds],
        );
      }
      if (onCommitting) {
        await onCommitting(client, updated);
      }
      return updated;
    });
  }

  async delete(id: number): Promise<boolean> {
    // ON DELETE CASCADE on comment_mentions.comment_id cleans the mention
    // rows automatically — no separate DELETE needed.
    const result = await this.db.query(`DELETE FROM comments WHERE id = $1`, [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Paginated mention lookup for §3.6 GET /users/:userId/mentions.
   *
   * Returns the mention's comment alongside its own mentionedUsers (which
   * may include the requesting user AND others mentioned in the same
   * comment — that's what the README contract shows).
   *
   * Implemented as two queries:
   *   1. Page of comments where `userId` is mentioned, newest first.
   *   2. Bulk-fetch ALL mentions for those comments (via
   *      findMentionedUsersForComments) so the response includes the full
   *      mention set per comment.
   *
   * Plus one COUNT query for the `total`. Three queries total, all
   * index-backed.
   */
  async findCommentsMentioning(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<{ rows: CommentRow[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [{ rows: dataRows }, { rows: countRows }] = await Promise.all([
      this.db.query<CommentRow>(
        `SELECT ${CommentsRepository.COLUMNS}
           FROM comments c
          WHERE EXISTS (
            SELECT 1 FROM comment_mentions cm
             WHERE cm.comment_id = c.id
               AND cm.mentioned_user_id = $1
          )
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT $2 OFFSET $3`,
        [userId, pageSize, offset],
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM comment_mentions
          WHERE mentioned_user_id = $1`,
        [userId],
      ),
    ]);
    return { rows: dataRows, total: Number(countRows[0].count) };
  }
}
