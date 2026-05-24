import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { CsvExportService } from './csv/csv-export.service';
import { CsvImportService } from './csv/csv-import.service';
import { DependenciesController } from './dependencies.controller';
import { DependenciesRepository } from './dependencies.repository';
import { DependenciesService } from './dependencies.service';
import { TicketsController } from './tickets.controller';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';
import { WorkloadController } from './workload.controller';

/**
 * Imports UsersModule to validate assignees and ProjectsModule to validate
 * the parent project.
 *
 * Controllers:
 *   - TicketsController        — /tickets (incl. Phase 8 CSV + soft-delete)
 *   - DependenciesController   — /tickets/:ticketId/dependencies (§3.2)
 *   - WorkloadController       — /projects/:projectId/workload  (§3.8)
 *
 * Exports TicketsService (used by Comments + Attachments) and
 * TicketsRepository (used by SchedulerModule for escalation).
 */
@Module({
  imports: [UsersModule, ProjectsModule],
  controllers: [TicketsController, DependenciesController, WorkloadController],
  providers: [
    TicketsService,
    TicketsRepository,
    DependenciesService,
    DependenciesRepository,
    CsvExportService,
    CsvImportService,
  ],
  exports: [TicketsService, TicketsRepository],
})
export class TicketsModule {}
