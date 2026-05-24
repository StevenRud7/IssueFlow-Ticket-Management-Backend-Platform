import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DependenciesService } from './dependencies.service';
import { BlockerRow } from './dependencies.repository';
import { AddDependencyDto } from './dto/add-dependency.dto';

/**
 * Ticket dependency endpoints (§3.2 / README contract):
 *   POST   /tickets/:ticketId/dependencies          body { blockedBy }
 *   GET    /tickets/:ticketId/dependencies
 *   DELETE /tickets/:ticketId/dependencies/:blockerId
 *
 * Protected by the global JWT guard. Mutating routes thread
 * `@CurrentUser('id')` for audit logging.
 */
@Controller('tickets/:ticketId/dependencies')
export class DependenciesController {
  constructor(private readonly dependencies: DependenciesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async add(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: AddDependencyDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.dependencies.add(ticketId, dto.blockedBy, performedBy);
  }

  @Get()
  list(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<BlockerRow[]> {
    return this.dependencies.list(ticketId);
  }

  @Delete(':blockerId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('blockerId', ParseIntPipe) blockerId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.dependencies.remove(ticketId, blockerId, performedBy);
  }
}
