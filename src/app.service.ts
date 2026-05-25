import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

/**
 * Application-level service backing the root endpoints (`GET /` and
 * `GET /health`). Not tied to any feature module — it exists to expose a
 * greeting and a database-reachability probe.
 */
@Injectable()
export class AppService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Reports liveness + database reachability. Used to verify Phase 1 wiring
   * end-to-end (config → DI → pg pool → query).
   */
  async health(): Promise<{
    status: 'ok' | 'degraded';
    database: 'up' | 'down';
    timestamp: string;
  }> {
    let database: 'up' | 'down' = 'down';
    try {
      await this.db.query('SELECT 1');
      database = 'up';
    } catch {
      // swallowed — caller sees status: degraded
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Returns a static "is running" string for the public `GET /` endpoint.
   */
  greeting(): string {
    return 'IssueFlow is running!';
  }
}