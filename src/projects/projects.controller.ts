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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectResponse } from './entities/project.entity';
import { ProjectsService } from './projects.service';

/**
 * Project endpoints.
 *
 * Core CRUD (README contract):
 *   GET    /projects
 *   GET    /projects/:projectId
 *   POST   /projects
 *   PATCH  /projects/:projectId
 *   DELETE /projects/:projectId       (soft-delete)
 *
 * Phase 8 additions:
 *   GET    /projects/deleted          list soft-deleted   (ADMIN only)
 *   POST   /projects/:projectId/restore  restore          (ADMIN only)
 *
 * Route ordering: `GET /projects/deleted` is declared BEFORE
 * `GET /projects/:projectId` so "deleted" isn't captured as a projectId.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findAll(): Promise<ProjectResponse[]> {
    return this.projectsService.findAll();
  }

  /**
   * List soft-deleted projects. ADMIN only (§3.5). Declared before the
   * :projectId route so the literal "deleted" segment wins.
   */
  @Get('deleted')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  findDeleted(): Promise<ProjectResponse[]> {
    return this.projectsService.findDeleted();
  }

  @Get(':projectId')
  findOne(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<ProjectResponse> {
    return this.projectsService.findById(projectId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<ProjectResponse> {
    return this.projectsService.create(dto, performedBy);
  }

  @Patch(':projectId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<ProjectResponse> {
    return this.projectsService.update(projectId, dto, performedBy);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.projectsService.softDelete(projectId, performedBy);
  }

  /**
   * Restore a soft-deleted project. ADMIN only (§3.5).
   */
  @Post(':projectId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async restore(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.projectsService.restore(projectId, performedBy);
  }
}
