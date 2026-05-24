import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

/**
 * Exports ProjectsService so the future TicketsModule (also Phase 4) can
 * inject it to validate `projectId` during ticket creation.
 */
@Module({
  imports: [UsersModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
export class ProjectsModule {}
