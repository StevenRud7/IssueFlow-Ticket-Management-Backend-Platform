import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * Input for POST /tickets/:ticketId/dependencies.
 *
 * Per the README contract the body is `{ "blockedBy": 42 }`, meaning the
 * path ticket (:ticketId) is blocked by ticket 42.
 *
 * The service enforces (§3.2):
 *   - both tickets exist
 *   - both belong to the same project
 *   - no self-dependency (a ticket can't block itself)
 *   - no cycles (adding the edge mustn't create a loop in the blocker graph)
 */
export class AddDependencyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  blockedBy!: number;
}
