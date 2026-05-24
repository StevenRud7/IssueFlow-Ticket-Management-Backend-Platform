import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Marked @Global so feature modules don't have to re-import DatabaseModule
 * just to inject DatabaseService. Registered once in AppModule.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
