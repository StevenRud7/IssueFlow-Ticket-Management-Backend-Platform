import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database/database.service';

describe('AppController', () => {
  let appController: AppController;
  let dbMock: { query: jest.Mock };

  beforeEach(async () => {
    dbMock = {
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DatabaseService, useValue: dbMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "IssueFlow is running!"', () => {
      expect(appController.getHello()).toBe('IssueFlow is running!');
    });
  });

  describe('health', () => {
    it('returns ok when the database is reachable', async () => {
      const result = await appController.health();
      expect(result.status).toBe('ok');
      expect(result.database).toBe('up');
      expect(dbMock.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns degraded when the database is unreachable', async () => {
      dbMock.query.mockRejectedValueOnce(new Error('connection refused'));
      const result = await appController.health();
      expect(result.status).toBe('degraded');
      expect(result.database).toBe('down');
    });
  });
});
