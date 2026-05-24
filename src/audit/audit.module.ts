import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * Marked @Global so feature modules don't have to import AuditModule
 * just to inject AuditService. Registered once in AppModule.
 *
 * Same pattern as DatabaseModule (Phase 1) — cross-cutting concerns
 * benefit from global registration; it removes ceremony from every
 * feature module that needs to emit audit entries.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}
