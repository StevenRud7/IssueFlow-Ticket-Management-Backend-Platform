import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { TicketsService } from './tickets.service';

/**
 * §3.8 workload endpoint:
 *   GET /projects/:projectId/workload
 *
 * Lives in the Tickets module (not Projects) because the data is
 * ticket-centric — it counts non-DONE tickets per developer. Same pattern
 * as Phase 5's UserMentionsController: the controller's path prefix
 * doesn't have to match its module.
 *
 * Returns [{ userId, username, openTicketCount }] sorted by
 * openTicketCount ascending.
 */
@Controller('projects/:projectId/workload')
export class WorkloadController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  getWorkload(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<{ userId: number; username: string; openTicketCount: number }[]> {
    return this.tickets.getWorkload(projectId);
  }
}
