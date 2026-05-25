import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';
import { AppService } from './app.service';

/**
 * Root controller for the two public, unauthenticated endpoints:
 * `GET /` (a greeting) and `GET /health` (a liveness + DB-reachability
 * probe). Both are marked @Public so the global JWT guard skips them.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * GET / — returns a simple "is running" greeting. Public.
   */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.greeting();
  }

  /**
   * Liveness + DB reachability probe. Returns 200 with status=ok when the
   * database is reachable, status=degraded otherwise. Useful for both manual
   * smoke testing and container orchestrators.
   */
  @Public()
  @Get('health')
  async health() {
    return this.appService.health();
  }
}