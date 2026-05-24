/**
 * Jest setup file for the e2e suite (referenced by jest-e2e.json's
 * `setupFilesAfterEnv`).
 *
 * The e2e tests run against a REAL PostgreSQL database — the same engine
 * the app uses in production, not an in-memory fake — because much of the
 * behaviour being verified (optimistic-locking version bumps, soft-delete
 * filtering, cascade rules, enum constraints) lives in SQL and would be
 * invisible to a mocked datastore.
 *
 * Database selection: the helper in `utils/e2e-app.ts` builds the app with
 * whatever connection settings the environment provides. To run against a
 * dedicated test database, set the DB_* env vars (or DATABASE_URL) before
 * invoking `npm run test:e2e` — see run.md. Each test file truncates the
 * tables it needs in a `beforeAll`/`beforeEach`, so suites are independent
 * and order-insensitive.
 *
 * This file currently only widens the per-test timeout as a safety net for
 * slower CI machines; jest-e2e.json already sets it, and we reaffirm it
 * here so it applies even if the config is overridden on the command line.
 */
jest.setTimeout(30000);