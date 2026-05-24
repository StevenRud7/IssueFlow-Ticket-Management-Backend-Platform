import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TicketsModule } from '../tickets/tickets.module';
import { EscalationScheduler } from './escalation.scheduler';
import { EscalationService } from './escalation.service';
import { SchedulerController } from './scheduler.controller';

/**
 * Owns the §3.7 auto-escalation feature.
 *
 * ScheduleModule.forRoot() bootstraps NestJS's scheduling subsystem (the
 * SchedulerRegistry that EscalationScheduler uses to register its cron
 * job dynamically).
 *
 * Imports TicketsModule to reuse TicketsRepository — escalation reads the
 * overdue-ticket set and applies priority bumps through the same
 * repository the rest of the ticket code uses. AuditService is globally
 * available (Phase 6) so it doesn't need importing.
 */
@Module({
  imports: [ScheduleModule.forRoot(), TicketsModule],
  controllers: [SchedulerController],
  providers: [EscalationService, EscalationScheduler],
})
export class SchedulerModule {}
