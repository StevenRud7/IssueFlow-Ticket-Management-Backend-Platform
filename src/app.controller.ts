import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
