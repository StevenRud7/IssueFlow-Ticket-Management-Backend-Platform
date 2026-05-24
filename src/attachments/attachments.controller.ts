import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AttachmentsService } from './attachments.service';
import { AttachmentResponse } from './entities/attachment.entity';

/**
 * Attachment endpoints (§3.3 / README contract):
 *   POST   /tickets/:ticketId/attachments               multipart "file"
 *   GET    /tickets/:ticketId/attachments                (list — convenience)
 *   DELETE /tickets/:ticketId/attachments/:attachmentId
 *
 * The upload uses Multer with memoryStorage — the file arrives as an
 * in-memory Buffer which AttachmentsService validates and then writes to
 * disk. `limits.fileSize` gives Multer a first-line size cap; the service
 * re-checks (defence in depth) so the 10 MB rule holds regardless.
 *
 * All routes are behind the global JWT guard. Mutating routes thread
 * `@CurrentUser('id')` for audit logging.
 */
@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: AttachmentsService.MAX_BYTES },
    }),
  )
  upload(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') performedBy: number,
  ): Promise<AttachmentResponse> {
    return this.attachments.upload(ticketId, file, performedBy);
  }

  @Get()
  list(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<AttachmentResponse[]> {
    return this.attachments.listForTicket(ticketId);
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.attachments.delete(ticketId, attachmentId, performedBy);
  }
}
