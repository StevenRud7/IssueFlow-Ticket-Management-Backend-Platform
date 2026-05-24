import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PaginationQuery } from '../common/dto/pagination.query';
import { CommentsService } from './comments.service';
import { PaginatedMentions } from './entities/comment.entity';

/**
 * Implements the §3.6 GET /users/:userId/mentions endpoint.
 *
 * Lives in CommentsModule (not UsersModule) because the data flows
 * through CommentsService — moving the controller here avoids a circular
 * import between UsersModule and CommentsModule. Controllers in NestJS
 * don't have to live in the module whose name matches their path prefix.
 *
 * Path matches the README contract exactly: GET /users/:userId/mentions
 * with optional `page` and `pageSize` query parameters.
 */
@Controller('users/:userId/mentions')
export class UserMentionsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  findMentions(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() pagination: PaginationQuery,
  ): Promise<PaginatedMentions> {
    return this.commentsService.findMentionsForUser(
      userId,
      pagination.page ?? 1,
      pagination.pageSize ?? 20,
    );
  }
}
