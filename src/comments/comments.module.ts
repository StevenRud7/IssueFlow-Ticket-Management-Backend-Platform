import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { UserMentionsController } from './user-mentions.controller';

/**
 * Imports UsersModule (to resolve @mentions and validate authors) and
 * TicketsModule (to validate the parent ticket exists).
 *
 * Two controllers:
 *   - CommentsController       — /tickets/:ticketId/comments
 *   - UserMentionsController   — /users/:userId/mentions (§3.6)
 *
 * Both share CommentsService. Mentions controller lives here (not in
 * UsersModule) to avoid a circular import.
 */
@Module({
  imports: [UsersModule, TicketsModule],
  controllers: [CommentsController, UserMentionsController],
  providers: [CommentsService, CommentsRepository],
  exports: [CommentsService],
})
export class CommentsModule {}
