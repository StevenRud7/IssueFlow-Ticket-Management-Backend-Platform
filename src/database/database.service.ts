import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Single seam between the application and PostgreSQL.
 *
 * Every repository in the codebase depends on this service and never touches
 * `pg` directly. That keeps connection management in one place and makes it
 * trivial to swap drivers or add instrumentation later.
 *
 * Two primary methods:
 *
 *  - `query<T>(sql, params)` — fire a single statement against the pool.
 *  - `transaction<T>(fn)`    — borrow a client from the pool, run BEGIN, hand
 *    the client to `fn`, then COMMIT (or ROLLBACK on throw). All multi-step
 *    writes that need atomicity (e.g. creating a comment + its mentions) go
 *    through here.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    // `.trim()` defends against a connection string with stray whitespace —
    // a common Windows pitfall where a `set "VAR=value"` quoting slip leaves
    // a trailing space, producing a confusing "database does not exist".
    const connectionString = this.config.get<string>('DATABASE_URL')?.trim();
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env and adjust.',
      );
    }

    this.pool = new Pool({
      connectionString,
      max: Number(this.config.get<string>('DATABASE_POOL_MAX') ?? 10),
      idleTimeoutMillis: Number(
        this.config.get<string>('DATABASE_POOL_IDLE_TIMEOUT_MS') ?? 30_000,
      ),
    });

    // Surface pool-level errors instead of silently dropping them. A client in
    // the pool can emit `error` if the backend kills the connection.
    this.pool.on('error', (err) => {
      this.logger.error(
        `Unexpected error on idle pg client: ${err.message}`,
        err.stack,
      );
    });

    // Fail fast: a misconfigured DATABASE_URL should crash boot, not the first
    // request that happens to need the database.
    try {
      const { rows } = await this.pool.query<{ now: Date }>('SELECT NOW()');
      this.logger.log(
        `Connected to PostgreSQL (server time: ${rows[0].now.toISOString()})`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Failed to connect to PostgreSQL: ${msg}`);
      if (/does not exist/i.test(msg)) {
        this.logger.error(
          'The target database does not exist. Check DATABASE_URL — on ' +
            'Windows a leftover "set DATABASE_URL=..." persists for the whole ' +
            'terminal session; clear it (set DATABASE_URL= / Remove-Item ' +
            'Env:DATABASE_URL) or open a fresh terminal so .env is used.',
        );
      }
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('PostgreSQL pool closed');
    }
  }

  /**
   * Run a single parameterised statement. Use $1, $2, ... placeholders — never
   * string-concatenate values into SQL.
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params as unknown[]);
  }

  /**
   * Run `fn` inside a transaction. Commits on resolve, rolls back on throw.
   *
   *   await db.transaction(async (client) => {
   *     await client.query('INSERT INTO comments ...');
   *     await client.query('INSERT INTO comment_mentions ...');
   *   });
   *
   * Always go through this helper for multi-statement writes — don't BEGIN
   * manually on a pool client, since releasing without committing leaks the
   * client back to the pool in an indeterminate state.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error(`Rollback failed: ${(rollbackErr as Error).message}`);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Escape hatch for places that need the raw pool (e.g. health checks).
   * Most callers should never use this.
   */
  getPool(): Pool {
    return this.pool;
  }
}