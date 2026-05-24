import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { PgExceptionFilter } from './filters/pg-exception.filter';

/**
 * Applies the global validation pipe and exception filters to a Nest app.
 *
 * Extracted so the e2e test harness configures its app instance EXACTLY
 * the way `main.ts` configures the production one. If validation or error
 * handling were only wired up in `main.ts`, the e2e tests would exercise a
 * subtly different app than the one that actually ships — defeating their
 * purpose. With this shared function, there is a single source of truth.
 *
 *  - whitelist            : strip properties not declared on the DTO
 *  - forbidNonWhitelisted : 400 when the client sends an unknown property
 *  - transform            : coerce primitives (param "1" → number 1)
 *  - §4.1 "Don't allow invalid values into the API" is enforced here.
 *
 * Filter order matters: the specific Postgres-error filter is registered
 * before the catch-all so it gets first chance at a pg error.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(), new PgExceptionFilter());
}