import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsRepository } from './attachments.repository';
import { AttachmentsService } from './attachments.service';

/**
 * Imports TicketsModule to validate the parent ticket exists before
 * accepting an upload. AuditService is globally available (Phase 6).
 *
 * ConfigService (for UPLOAD_DIR) comes from the global ConfigModule.
 */
@Module({
  imports: [TicketsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsRepository],
})
export class AttachmentsModule {}
