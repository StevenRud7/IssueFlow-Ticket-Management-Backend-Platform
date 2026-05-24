import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommentsModule } from './comments/comments.module';
import { DatabaseModule } from './database/database.module';
import { ProjectsModule } from './projects/projects.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

/**
 * Root module.
 *
 * Phase 1: ConfigModule (env vars) and DatabaseModule (pg pool).
 * Phase 2: UsersModule.
 * Phase 3: AuthModule — globally enforces JWT via APP_GUARD.
 * Phase 4: ProjectsModule, TicketsModule.
 * Phase 5: CommentsModule (also hosts UserMentionsController on /users/:id/mentions).
 * Phase 6: AuditModule — globally available; every mutating service emits entries.
 * Phase 7: SchedulerModule — cron-driven priority escalation. (Dependencies &
 *          auto-assignment & workload all live inside TicketsModule.)
 * Phase 8: AttachmentsModule. (Soft-delete management & CSV endpoints live
 *          inside ProjectsModule / TicketsModule.)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    AuditModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    TicketsModule,
    CommentsModule,
    SchedulerModule,
    AttachmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
