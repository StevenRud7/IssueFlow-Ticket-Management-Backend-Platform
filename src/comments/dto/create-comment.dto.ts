import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min } from 'class-validator';

/**
 * Input for POST /tickets/:ticketId/comments.
 *
 * Per the README contract: { "authorId": 2, "content": "Hello @jdoe!" }
 *
 * `authorId` is in the body (not derived from the JWT) — this matches the
 * contract literally. In a real system you'd usually derive the author
 * from the authenticated user, but we follow the spec.
 *
 * `content` length capped at 10,000 chars to keep DB rows reasonable and
 * prevent denial-of-service via huge mention payloads.
 */
export class CreateCommentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  authorId!: number;

  @IsString()
  @Length(1, 10_000)
  content!: string;
}
