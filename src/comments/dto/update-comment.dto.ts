import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * Input for PATCH /tickets/:ticketId/comments/:commentId.
 *
 * Only `content` is updatable — authorId and ticketId are part of the
 * comment's identity and shouldn't change after creation.
 *
 * `version` powers optimistic locking (§2.5 "two users can't edit a
 * comment at the same time"). Required; the service throws 400 if omitted,
 * with a hint explaining what to send.
 */
export class UpdateCommentDto {
  @IsString()
  @Length(1, 10_000)
  content!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
