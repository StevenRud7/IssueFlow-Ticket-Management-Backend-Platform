import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { TicketPriority } from '../entities/ticket-priority.enum';
import { TicketStatus } from '../entities/ticket-status.enum';

/**
 * Input for PATCH /tickets/:ticketId. All fields optional.
 *
 * `type` is intentionally NOT in this DTO — a ticket's type (BUG / FEATURE /
 * TECHNICAL) is part of its identity and shouldn't change after creation.
 * `projectId` is also not updatable — moving a ticket between projects
 * would require cascade-updating dependencies, comments, etc., which is
 * outside the contract.
 *
 * `version` powers optimistic locking (§2.4 "ticket can't be updated
 * simultaneously by two users"). The service requires it; missing it
 * produces a 400 explaining why.
 *
 * The README's example PATCH body doesn't list `version`, but it's the
 * standard pattern for the concurrency requirement and doesn't violate
 * the contract (the DTO accepts a superset of the example fields).
 *
 * `assigneeId` accepts null explicitly — sending `{"assigneeId": null}`
 * unassigns the ticket. We use a workaround: null fails @IsInt, so we
 * model "unassign" by also accepting null via @ValidateIf. To keep things
 * simple in this Phase, we don't support unassign — Phase 7 (auto-assign)
 * will add it.
 */
export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TicketStatus, {
    message: `status must be one of: ${Object.values(TicketStatus).join(', ')}`,
  })
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority, {
    message: `priority must be one of: ${Object.values(TicketPriority).join(', ')}`,
  })
  priority?: TicketPriority;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigneeId?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /**
   * Optimistic-lock token. Send the current `version` from the ticket
   * response; the server rejects with 409 if the row has moved on. Strongly
   * recommended; without it, two clients can stomp on each other.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
