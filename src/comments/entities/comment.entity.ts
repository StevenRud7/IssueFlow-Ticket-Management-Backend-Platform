/**
 * Shape of a `comments` table row from pg. As with tickets, `version`
 * powers optimistic locking (§2.5 "two users can't edit a comment at the
 * same time").
 */
export interface CommentRow {
  id: number;
  ticket_id: number;
  author_id: number;
  content: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * One row from `comment_mentions` joined to `users`, used to build the
 * `mentionedUsers` array in the response.
 */
export interface MentionedUserRow {
  id: number;
  username: string;
  full_name: string;
}

/**
 * Public-facing shape. Matches the README contract exactly — including the
 * `mentionedUsers` array of `{ id, username, fullName }`.
 *
 * We also expose `version` so clients can pass it back on PATCH for the
 * optimistic-lock pattern that §2.5 requires. The README example doesn't
 * include `version`, but the DTO accepts a superset of the example.
 */
export interface MentionedUser {
  id: number;
  username: string;
  fullName: string;
}

export interface CommentResponse {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
  mentionedUsers: MentionedUser[];
  version: number;
}

export function toCommentResponse(
  row: CommentRow,
  mentions: MentionedUserRow[],
): CommentResponse {
  return {
    id: Number(row.id),
    ticketId: Number(row.ticket_id),
    authorId: Number(row.author_id),
    content: row.content,
    mentionedUsers: mentions.map((m) => ({
      id: Number(m.id),
      username: m.username,
      fullName: m.full_name,
    })),
    version: row.version,
  };
}

/**
 * Used by GET /users/:userId/mentions. Same shape as CommentResponse —
 * each item IS a comment, just filtered to ones where the user is
 * mentioned. The README contract shows this exact shape inside the
 * paginated envelope.
 */
export interface PaginatedMentions {
  data: CommentResponse[];
  total: number;
  page: number;
}
