import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/configure-app';
import { DatabaseService } from '../../src/database/database.service';

/**
 * Shared harness for the e2e suites.
 *
 * `bootstrapTestApp()` builds the real AppModule — the same module graph
 * `main.ts` boots — applies the same global pipes/filters via
 * `configureApp`, and returns handles the test files need:
 *
 *   - `app`     : the INestApplication (call app.close() in afterAll)
 *   - `server`  : the underlying HTTP server, passed to supertest
 *   - `db`      : the DatabaseService, so a suite can TRUNCATE between tests
 *
 * Every e2e suite shares one PostgreSQL database, so jest-e2e.json pins
 * `maxWorkers: 1` (suites run sequentially) and each suite calls
 * `resetDatabase()` in a `beforeAll`/`beforeEach` to start from a known
 * clean state.
 */
export interface TestContext {
  app: INestApplication;
  server: App;
  db: DatabaseService;
}

/**
 * The full list of mutable tables, in an order safe for TRUNCATE ...
 * CASCADE. RESTART IDENTITY resets the SERIAL sequences so ids are
 * predictable (the first inserted user is always id 1, etc.).
 */
const ALL_TABLES = [
  'attachments',
  'comment_mentions',
  'comments',
  'ticket_dependencies',
  'audit_logs',
  'tickets',
  'projects',
  'token_denylist',
  'users',
];

export async function bootstrapTestApp(): Promise<TestContext> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const db = app.get(DatabaseService);
  return {
    app,
    server: app.getHttpServer() as App,
    db,
  };
}

/**
 * Wipe every table and reset identity sequences. Called between tests so
 * each one runs against a clean, predictable database.
 */
export async function resetDatabase(db: DatabaseService): Promise<void> {
  await db.query(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}