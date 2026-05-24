/* eslint-disable no-console */
/**
 * Standalone migration runner.
 *
 *   npm run migrate            # apply pending migrations
 *   npm run migrate:rollback   # not implemented; SQL down-migrations are
 *                              # outside the scope of this assignment, but
 *                              # the entry point is wired so adding them
 *                              # later is one function away.
 *
 * Migration files live in src/database/migrations and must be named
 * NNN_description.sql with a zero-padded integer prefix so lexicographic
 * sort matches execution order (001_init.sql, 002_add_something.sql, ...).
 *
 * A schema_migrations table records which files have been applied so the
 * runner is safe to re-run on a populated database — only un-applied files
 * execute.
 *
 * Each file is wrapped in a single transaction so a partial failure leaves
 * the schema untouched.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(rows.map((r) => r.filename));
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function applyMigration(client: Client, filename: string): Promise<void> {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(fullPath, 'utf8');

  console.log(`▶ applying ${filename}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
      filename,
    ]);
    await client.query('COMMIT');
    console.log(`✓ applied  ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = (err as Error).message;
    console.error(`✗ failed   ${filename}: ${msg}`);
    throw err;
  }
}

/**
 * Extract the database name from a postgres connection string, for use in
 * human-readable diagnostics. Returns '(unknown)' if it can't be parsed.
 */
function databaseNameOf(connectionString: string): string {
  try {
    // The path of the URL is "/dbname".
    const dbName = new URL(connectionString).pathname.replace(/^\//, '');
    return dbName || '(none)';
  } catch {
    return '(unparseable)';
  }
}

async function migrate(): Promise<void> {
  // `.trim()` defends against a connection string that picked up stray
  // whitespace — a common Windows pitfall where `set "VAR=value"` quoting
  // is missed and the value ends up like "...issueflow_test " with a
  // trailing space, producing a confusing "database does not exist" error.
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const dbName = databaseNameOf(connectionString);
  const client = new Client({ connectionString });

  try {
    await client.connect();
  } catch (err) {
    const message = (err as Error).message;
    console.error(`Could not connect to the database. ${message}`);
    if (/does not exist/i.test(message)) {
      console.error(
        `\nThe target database is "${dbName}". Either:\n` +
          `  - it has not been created yet — create it, e.g.\n` +
          `      docker compose exec db createdb -U issueflow ${dbName}\n` +
          `  - or DATABASE_URL is pointing at the wrong database. On Windows a\n` +
          `    leftover 'set DATABASE_URL=...' from an earlier command persists\n` +
          `    for the whole terminal session — clear it with 'set DATABASE_URL='\n` +
          `    (cmd) / 'Remove-Item Env:DATABASE_URL' (PowerShell), or open a\n` +
          `    fresh terminal so the value falls back to .env.`,
      );
    }
    process.exit(1);
  }

  try {
    console.log(`Connected to database "${dbName}".`);
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = listMigrationFiles();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('No pending migrations — database is up to date.');
      return;
    }

    console.log(`Found ${pending.length} pending migration(s):`);
    pending.forEach((f) => console.log(`  - ${f}`));

    for (const file of pending) {
      await applyMigration(client, file);
    }

    console.log('All migrations applied successfully.');
  } finally {
    await client.end();
  }
}

async function rollback(): Promise<void> {
  console.error(
    'Rollback is not implemented. Drop the database and re-run `npm run migrate` to reset.',
  );
  process.exit(1);
}

const command = process.argv[2] ?? 'up';
const action = command === 'rollback' ? rollback : migrate;

action().catch((err) => {
  console.error(`Migration failed: ${(err as Error).message}`);
  process.exit(1);
});