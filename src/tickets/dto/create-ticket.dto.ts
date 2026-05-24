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
import { TicketType } from '../entities/ticket-type.enum';

/**
 * Input for POST /tickets. Mirrors the README example body.
 *
 * Notes:
 *   - `status` is optional on create — if omitted, the DB column default
 *     ('TODO') applies. The DTO accepts any legal status, but creating a
 *     ticket directly in DONE is unusual and could be argued either way.
 *     We allow it; the lifecycle rules only kick in on UPDATE.
 *
 *   - `priority` is also optional — DB default is 'MEDIUM'.
 *
 *   - `type` is required (BUG / FEATURE / TECHNICAL) — there's no sensible
 *     default.
 *
 *   - `dueDate` must be an ISO-8601 string when present. The DB column is
 *     timestamptz; pg's driver handles the conversion.
 *
 *   - `assigneeId` is optional. In Phase 7, when it's omitted on create,
 *     auto-assignment picks the developer with the fewest open tickets.
 */
export class CreateTicketDto {
  @IsString()
  @Length(1, 255)
  title!: string;

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

  @IsEnum(TicketType, {
    message: `type must be one of: ${Object.values(TicketType).join(', ')}`,
  })
  type!: TicketType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigneeId?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
