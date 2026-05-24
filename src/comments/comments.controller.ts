import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentResponse } from './entities/comment.entity';

/**
 * Comment endpoints under /tickets/:ticketId/comments per the README:
 *   GET    /tickets/:ticketId/comments
 *   POST   /tickets/:ticketId/comments
 *   PATCH  /tickets/:ticketId/comments/:commentId
 *   DELETE /tickets/:ticketId/comments/:commentId
 *
 * Phase 6: mutating endpoints pass `@CurrentUser('id')` for audit
 * logging.
 */
@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  findAll(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<CommentResponse[]> {
    return this.commentsService.findByTicket(ticketId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<CommentResponse> {
    return this.commentsService.create(ticketId, dto, performedBy);
  }

  @Patch(':commentId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<CommentResponse> {
    return this.commentsService.update(ticketId, commentId, dto, performedBy);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.commentsService.delete(ticketId, commentId, performedBy);
  }
}
