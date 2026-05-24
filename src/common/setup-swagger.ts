import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Mounts an interactive Swagger UI at /docs.
 *
 * This is a developer convenience for manually exercising the API from a
 * browser — comparable in spirit to a Spring Boot H2 console, but for the
 * HTTP API rather than the database. Every endpoint is listed with a
 * "Try it out" button.
 *
 * Auth: a single Bearer scheme named 'access-token' is registered. Click
 * "Authorize" in the UI, paste a JWT obtained from POST /auth/login, and
 * it is sent on every subsequent request — so the protected endpoints are
 * usable straight from the page.
 *
 * The UI is only mounted when SWAGGER_ENABLED is not 'false', so it can be
 * switched off for a production deployment via env.
 */
export function setupSwagger(app: INestApplication): void {
  if (process.env.SWAGGER_ENABLED === 'false') {
    return;
  }

  const config = new DocumentBuilder()
    .setTitle('IssueFlow API')
    .setDescription(
      'Interactive API console for the IssueFlow issue-tracking backend. ' +
        'Use POST /auth/login to obtain a token, then click "Authorize" ' +
        'and paste it to call the protected endpoints.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the accessToken returned by POST /auth/login',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      // keep the pasted token across page reloads
      persistAuthorization: true,
    },
  });
}