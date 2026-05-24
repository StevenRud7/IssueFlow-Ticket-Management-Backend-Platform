import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthenticatedUser, LoginResponse } from './auth.types';

/**
 * Authentication endpoints from §2.2 / README.
 *
 *   POST /auth/login   — public, exchanges credentials for a JWT
 *   POST /auth/logout  — authenticated, revokes the current token
 *   GET  /auth/me      — authenticated, returns the current user
 *
 * No business logic — the service does the work. The @Public() decorator
 * on login is critical: without it, JwtAuthGuard (registered globally)
 * would reject the login request and there'd be no way to ever get a token.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto.username, dto.password);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logout(user.id, user.jti, user.exp);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): {
    id: number;
    username: string;
    role: AuthenticatedUser['role'];
  } {
    // Trim JWT-internal fields (jti, exp) from the response — the README
    // doesn't define an exact shape for /auth/me, so we return the bits a
    // client actually needs to know.
    return { id: user.id, username: user.username, role: user.role };
  }
}
