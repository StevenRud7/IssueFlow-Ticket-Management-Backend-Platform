import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

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

  greeting(): string {
    return 'IssueFlow is running!';
  }
}
