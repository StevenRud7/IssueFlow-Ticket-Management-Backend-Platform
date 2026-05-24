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
import { Public } from '../auth/decorators/public.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponse } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * Thin handler layer. No business logic lives here — just routes the request
 * to the service and lets the global ValidationPipe enforce DTO shape.
 *
 * Endpoints exactly match the README contract:
 *   GET    /users
 *   GET    /users/:userId
 *   POST   /users
 *   POST   /users/update/:userId   ← unusual but per the contract
 *   DELETE /users/:userId
 *
 * `ParseIntPipe` parses `:userId` to a number and 400s on anything else.
 * `HttpCode(200)` on POST creates matches the README's "200 OK" (vs. the
 * REST-idiomatic 201). Sticking to the contract.
 *
 * Phase 6: passes the authenticated user's id (`@CurrentUser('id')`) into
 * mutating service methods so audit entries record `performed_by`. The
 * public POST /users endpoint passes null — there's no authenticated user
 * during registration, and the service substitutes the newly-created
 * user's id (self-creation).
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(): Promise<UserResponse[]> {
    return this.usersService.findAll();
  }

  @Get(':userId')
  findOne(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<UserResponse> {
    return this.usersService.findById(userId);
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.usersService.create(dto, null);
  }

  @Post('update/:userId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') performedBy: number,
  ): Promise<UserResponse> {
    return this.usersService.update(userId, dto, performedBy);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser('id') performedBy: number,
  ): Promise<void> {
    await this.usersService.delete(userId, performedBy);
  }
}
