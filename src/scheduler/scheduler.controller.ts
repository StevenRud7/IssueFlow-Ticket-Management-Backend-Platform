import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { EscalationService } from './escalation.service';

/**
 * Operational endpoint to trigger an escalation cycle on demand, without
 * waiting for the next cron tick. ADMIN-only.
 *
 * Not part of the README contract — it's a convenience for testing and
 * operations. The escalation feature itself (§3.7) is fully automatic via
 * the cron scheduler; this endpoint just lets you observe a cycle
 * immediately. Returns the cycle summary.
 */
@Controller('admin/escalation')
@UseGuards(RolesGuard)
export class SchedulerController {
  constructor(private readonly escalation: EscalationService) {}

  @Post('run')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  run(): Promise<{
    scanned: number;
    promoted: number;
    markedOverdue: number;
    skipped: number;
  }> {
    return this.escalation.runOnce();
  }
}
