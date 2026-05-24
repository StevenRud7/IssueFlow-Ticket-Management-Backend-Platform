import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { setupSwagger } from './common/setup-swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Global validation pipe + exception filters. Extracted into
  // configureApp() so the e2e tests build an identically-configured app.
  configureApp(app);

  // Interactive Swagger UI at /docs (developer convenience; can be turned
  // off with SWAGGER_ENABLED=false).
  setupSwagger(app);

  const port = Number(config.get<string>('PORT') ?? 3000);
  await app.listen(port);
  logger.log(`IssueFlow listening on http://localhost:${port}`);
  if (process.env.SWAGGER_ENABLED !== 'false') {
    logger.log(`Swagger UI available at http://localhost:${port}/docs`);
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});