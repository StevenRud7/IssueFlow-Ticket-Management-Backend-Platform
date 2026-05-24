import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EscalationService } from './escalation.service';

/**
 * Cron trigger for the escalation algorithm.
 *
 * The schedule is read from the ESCALATION_CRON env var (default
 * "0 * * * *" — the top of every hour) and registered dynamically at
 * startup via SchedulerRegistry. We use the dynamic API rather than the
 * static @Cron() decorator specifically so the expression can come from
 * configuration — @Cron() needs a compile-time constant.
 *
 * All the actual work lives in EscalationService.runOnce(); this class is
 * a thin wrapper that owns only the timer. A failure inside a cycle is
 * caught and logged so a transient DB error doesn't kill the cron job for
 * the lifetime of the process.
 */
@Injectable()
export class EscalationScheduler implements OnModuleInit {
  private readonly logger = new Logger(EscalationScheduler.name);
  private static readonly JOB_NAME = 'ticket-escalation';

  constructor(
    private readonly escalation: EscalationService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const cronExpr =
      this.config.get<string>('ESCALATION_CRON')?.trim() || '0 * * * *';

    const job = new CronJob(cronExpr, () => {
      void this.tick();
    });

    this.registry.addCronJob(EscalationScheduler.JOB_NAME, job as never);
    job.start();
    this.logger.log(`Escalation scheduler started with cron "${cronExpr}"`);
  }

  /**
   * One scheduled tick. Wrapped in try/catch so a failure is logged but
   * never escapes — an uncaught throw here would otherwise be an
   * unhandled rejection.
   */
  private async tick(): Promise<void> {
    try {
      await this.escalation.runOnce();
    } catch (err) {
      this.logger.error(
        `Escalation cycle failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
