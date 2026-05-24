import {
  BadRequestException,
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
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CsvExportService } from './csv/csv-export.service';
import { CsvImportService, ImportSummary } from './csv/csv-import.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketResponse } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';

/**
 * Ticket endpoints.
 *
 * Core CRUD (README contract):
 *   GET    /tickets?projectId=N
 *   GET    /tickets/:ticketId
 *   POST   /tickets
 *   PATCH  /tickets/:ticketId
 *   DELETE /tickets/:ticketId             (soft-delete)
 *
 * Phase 8 additions:
 *   GET    /tickets/export?projectId=N    CSV download
 *   POST   /tickets/import                CSV bulk upload
 *   GET    /tickets/deleted?projectId=N   list soft-deleted   (ADMIN only)
 *   POST   /tickets/:ticketId/restore     restore             (ADMIN only)
 *
 * IMPORTANT — route ordering: the static-segment routes (`export`,
 * `import`, `deleted`) are declared BEFORE the `:ticketId` param routes.
 * NestJS matches in declaration order; if `GET /tickets/:ticketId` came
 * first, a request for `/tickets/export` would bind ticketId="export"
 * and 400 in ParseIntPipe. Order here is load-bearing — don't reshuffle.
 */
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly csvExport: CsvExportService,
    private readonly csvImport: CsvImportService,
  ) {}

  // --- static-segment routes FIRST -----------------------------------------

  /**
   * CSV export. Streams a text/csv body with a Content-Disposition
   * attachment header so browsers download it as a file.
   */
  @Get('export')
  async exportCsv(
    @Query('projectId') projectIdRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const projectId = Number(projectIdRaw);
    if (!projectIdRaw || !Number.isInteger(projectId) || projectId < 1) {
      throw new BadRequestException(
        'projectId query parameter is required and must be a positive integer',
      );
    }
    const csv = await this.csvExport.exportProject(projectId);
    res
      .status(HttpStatus.OK)
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="${this.csvExport.filenameFor(projectId)}"`,
      )
      .send(csv);
  }

  /**
   * CSV import. multipart/form-data with a `file` part and a `projectId`
   * form field. Returns the { created, failed, errors } summary.
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // 10 MB cap on the CSV itself — generous for a ticket export.
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('projectId') projectIdRaw: string | undefined,
    @CurrentUser('id') performedBy: number,
  ): Promise<ImportSummary> {
    if (!file) {
      throw new BadRequestException(
        'No CSV file uploaded (multipart field name: file)',
      );
    }
    const projectId = Number(projectIdRaw);
    if (!projectIdRaw || !Number.isInteger(projectId) || projectId < 1) {
      throw new BadRequestException(
        'projectId form field is required and must be a positive integer',
      );
    }
    return this.csvImport.importIntoProject(
      projectId,
      file.buffer,
      performedBy,
    );
  }

  /**
   * List soft-deleted tickets of a project. ADMIN only (§3.5).
   */
  @Get('deleted')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  findDeleted(
    @Query('projectId') projectIdRaw: string | undefined,
  ): Promise<TicketResponse[]> {
    const projectId = Number(projectIdRaw);
    if (!projectIdRaw || !Number.isInteger(projectId) || projectId < 1) {
      throw new BadRequestException(
        'projectId query parameter is required and must be a positive integer',
      );
    }
    return this.ticketsService.findDeletedByProject(projectId);
  }

  // --- list + param routes -------------------------------------------------

  @Get()
  findAll(
    @Query('projectId') projectIdRaw?: string,
  ): Promise<TicketResponse[]> {
    if (projectIdRaw === undefined) {
      return this.ticketsService.findAll();
    }
    const projectId = Number(projectIdRaw);
    if (!Number.isInteger(projectId) || projectId < 1) {
      throw new BadRequestException('projectId must be a positive integer');
    }
    return this.ticketsService.findByProject(projectId);
  }

  @Get(':ticketId')
  findOne(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<TicketResponse> {
    return this.ticketsService.findById(ticketId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<TicketResponse> {
    return this.ticketsService.create(dto, performedBy);
  }

  @Patch(':ticketId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: UpdateTicketDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<TicketResponse> {
    return this.ticketsService.update(ticketId, dto, performedBy);
  }

  @Delete(':ticketId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.ticketsService.softDelete(ticketId, performedBy);
  }

  /**
   * Restore a soft-deleted ticket. ADMIN only (§3.5).
   */
  @Post(':ticketId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async restore(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.ticketsService.restore(ticketId, performedBy);
  }
}
