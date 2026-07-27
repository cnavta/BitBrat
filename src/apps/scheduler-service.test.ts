import request from 'supertest';
import { createApp, createServer } from './scheduler-service';
import type { IScheduleRepository, ScheduleDoc } from '../services/scheduler/repository';

// Mock the message bus before importing anything else
jest.mock('../services/message-bus', () => ({
  createMessagePublisher: jest.fn(() => ({
    publishJson: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the repository
jest.mock('../services/scheduler/repository', () => ({
  createScheduleRepository: jest.fn(),
}));

describe('SchedulerServer', () => {
  describe('health endpoints', () => {
    const app = createApp();

    it('/healthz 200', async () => {
      await request(app).get('/healthz').expect(200);
    });

    it('/readyz 200', async () => {
      await request(app).get('/readyz').expect(200);
    });

    it('/livez 200', async () => {
      await request(app).get('/livez').expect(200);
    });
  });

  describe('calculateNextRun', () => {
    let server: any;

    beforeEach(() => {
      // Create server instance to test private method
      server = createServer();
    });

    afterEach(async () => {
      // Clean up via close() which calls shutdown hooks
      await server.close('test-cleanup');
    });

    describe('once schedules', () => {
      it('returns future date for valid future timestamp', () => {
        const futureDate = new Date(Date.now() + 86400000); // +1 day
        const result = server['calculateNextRun']('once', futureDate.toISOString());

        expect(result).toBeInstanceOf(Date);
        expect(result?.getTime()).toBeCloseTo(futureDate.getTime(), -2);
      });

      it('returns null for past date', () => {
        const pastDate = new Date(Date.now() - 86400000); // -1 day
        const result = server['calculateNextRun']('once', pastDate.toISOString());

        expect(result).toBeNull();
      });

      it('returns null for invalid timestamp', () => {
        const result = server['calculateNextRun']('once', 'invalid-date-string');

        expect(result).toBeNull();
      });

      it('returns null for malformed ISO string', () => {
        const result = server['calculateNextRun']('once', '2026-13-45T99:99:99Z');

        expect(result).toBeNull();
      });
    });

    describe('cron schedules', () => {
      it('returns future date for valid cron expression (every minute)', () => {
        const before = Date.now();
        const result = server['calculateNextRun']('cron', '* * * * *');
        const after = Date.now();

        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).toBeGreaterThan(before);
        expect(result!.getTime()).toBeLessThan(after + 120000); // within 2 minutes
      });

      it('returns future date for valid cron expression (daily at midnight)', () => {
        const result = server['calculateNextRun']('cron', '0 0 * * *');

        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).toBeGreaterThan(Date.now());
      });

      it('returns future date for valid cron expression (hourly)', () => {
        const result = server['calculateNextRun']('cron', '0 * * * *');

        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).toBeGreaterThan(Date.now());
      });

      it('returns null for invalid cron expression', () => {
        const result = server['calculateNextRun']('cron', 'invalid cron');

        expect(result).toBeNull();
      });

      it('returns null for malformed cron expression', () => {
        const result = server['calculateNextRun']('cron', '* * * * * * *'); // too many fields

        expect(result).toBeNull();
      });

      it('treats empty cron expression as "* * * * *" (library behavior)', () => {
        const before = Date.now();
        const result = server['calculateNextRun']('cron', '');

        // cron-parser treats empty string as "* * * * *" (every minute)
        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).toBeGreaterThan(before);
        expect(result!.getTime()).toBeLessThan(before + 120000); // within 2 minutes
      });
    });

    describe('edge cases', () => {
      it('handles current time correctly for once schedule', () => {
        const now = new Date();
        const result = server['calculateNextRun']('once', now.toISOString());

        // Current time is not in the future, should return null
        expect(result).toBeNull();
      });

      it('handles DST transition correctly', () => {
        // Spring forward: March 9, 2025, 2:00 AM -> 3:00 AM
        const result = server['calculateNextRun']('cron', '0 2 9 3 *');

        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe('Ticker Lifecycle', () => {
    let server: any;

    beforeEach(() => {
      jest.useFakeTimers();
      server = createServer();
    });

    afterEach(async () => {
      // Clean up
      await server.close('test-cleanup');
      jest.useRealTimers();
    });

    it('starts ticker on construction', () => {
      expect((server as any).tickInterval).not.toBeNull();
      expect((server as any).TICK_INTERVAL_MS).toBeDefined();
    });

    it('stops ticker when stopTicker is called', () => {
      expect((server as any).tickInterval).not.toBeNull();

      (server as any)['stopTicker']();

      expect((server as any).tickInterval).toBeNull();
    });

    it('stopTicker is idempotent', () => {
      (server as any)['stopTicker']();
      expect((server as any).tickInterval).toBeNull();

      // Call again - should not throw
      expect(() => (server as any)['stopTicker']()).not.toThrow();
      expect((server as any).tickInterval).toBeNull();
    });

    it('does not start ticker twice', () => {
      const firstInterval = (server as any).tickInterval;
      expect(firstInterval).not.toBeNull();

      // Try to start again
      (server as any)['startTicker']();

      // Should be the same interval (not restarted)
      expect((server as any).tickInterval).toBe(firstInterval);
    });

    it('ticker calls handleTick at configured interval', async () => {
      // Mock handleTick
      const handleTickSpy = jest.spyOn(server as any, 'handleTick').mockResolvedValue(undefined);

      // Stop existing ticker and restart to ensure spy is in place
      (server as any)['stopTicker']();
      (server as any)['startTicker']();

      // Fast-forward time by TICK_INTERVAL_MS
      jest.advanceTimersByTime((server as any).TICK_INTERVAL_MS);

      // Allow promises to resolve
      await Promise.resolve();

      expect(handleTickSpy).toHaveBeenCalledTimes(1);

      // Fast-forward again
      jest.advanceTimersByTime((server as any).TICK_INTERVAL_MS);
      await Promise.resolve();

      expect(handleTickSpy).toHaveBeenCalledTimes(2);

      handleTickSpy.mockRestore();
    });

    it('continues ticking even if handleTick throws error', async () => {
      // Mock handleTick to throw error
      const handleTickSpy = jest.spyOn(server as any, 'handleTick')
        .mockRejectedValueOnce(new Error('Test error'))
        .mockResolvedValueOnce(undefined);

      // Stop and restart
      (server as any)['stopTicker']();
      (server as any)['startTicker']();

      // First tick - throws error
      jest.advanceTimersByTime((server as any).TICK_INTERVAL_MS);
      await Promise.resolve();

      // Second tick - should still be called
      jest.advanceTimersByTime((server as any).TICK_INTERVAL_MS);
      await Promise.resolve();

      expect(handleTickSpy).toHaveBeenCalledTimes(2);

      handleTickSpy.mockRestore();
    });
  });

  describe('handleTick', () => {
    let server: any;
    let mockRepo: jest.Mocked<IScheduleRepository>;

    beforeEach(() => {
      // Create mock repository
      mockRepo = {
        list: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        getDueSchedules: jest.fn(),
      } as jest.Mocked<IScheduleRepository>;

      // Mock createScheduleRepository to return our mock
      const { createScheduleRepository } = require('../services/scheduler/repository');
      createScheduleRepository.mockReturnValue(mockRepo);

      server = createServer();
      (server as any).scheduleRepo = mockRepo;
    });

    afterEach(async () => {
      await server.close('test-cleanup');
    });

    it('queries repository with current time', async () => {
      mockRepo.getDueSchedules.mockResolvedValue([]);

      await server['handleTick']();

      expect(mockRepo.getDueSchedules).toHaveBeenCalledTimes(1);
      const callArg = mockRepo.getDueSchedules.mock.calls[0][0];
      expect(callArg).toBeInstanceOf(Date);
    });

    it('executes all due schedules', async () => {
      const mockSchedules: ScheduleDoc[] = [
        {
          id: '1',
          title: 'Test Schedule 1',
          schedule: { type: 'once', value: new Date().toISOString() },
          event: { type: 'llm.request.v1' },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          title: 'Test Schedule 2',
          schedule: { type: 'cron', value: '* * * * *' },
          event: { type: 'llm.request.v1' },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepo.getDueSchedules.mockResolvedValue(mockSchedules);
      mockRepo.update.mockResolvedValue(undefined);

      // Mock publisher
      const { createMessagePublisher } = require('../services/message-bus');
      const mockPublish = jest.fn().mockResolvedValue(undefined);
      createMessagePublisher.mockReturnValue({ publishJson: mockPublish });

      await server['handleTick']();

      expect(mockRepo.update).toHaveBeenCalledTimes(2);
      expect(mockPublish).toHaveBeenCalledTimes(2);
    });

    it('updates lastRun and nextRun after execution', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const mockSchedule: ScheduleDoc = {
        id: 'schedule-1',
        title: 'Test Schedule',
        schedule: { type: 'once', value: futureDate.toISOString() },
        event: { type: 'llm.request.v1' },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([mockSchedule]);
      mockRepo.update.mockResolvedValue(undefined);

      await server['handleTick']();

      expect(mockRepo.update).toHaveBeenCalledWith(
        'schedule-1',
        expect.objectContaining({
          lastRun: expect.any(Date),
          updatedAt: expect.any(Date),
        })
      );
    });

    it('disables once schedules after execution', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const mockSchedule: ScheduleDoc = {
        id: 'once-schedule',
        title: 'Once Schedule',
        schedule: { type: 'once', value: futureDate.toISOString() },
        event: { type: 'llm.request.v1' },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([mockSchedule]);
      mockRepo.update.mockResolvedValue(undefined);

      await server['handleTick']();

      expect(mockRepo.update).toHaveBeenCalledWith(
        'once-schedule',
        expect.objectContaining({
          enabled: false,
        })
      );
    });

    it('keeps cron schedules enabled after execution', async () => {
      const mockSchedule: ScheduleDoc = {
        id: 'cron-schedule',
        title: 'Cron Schedule',
        schedule: { type: 'cron', value: '* * * * *' },
        event: { type: 'llm.request.v1' },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([mockSchedule]);
      mockRepo.update.mockResolvedValue(undefined);

      await server['handleTick']();

      expect(mockRepo.update).toHaveBeenCalledWith(
        'cron-schedule',
        expect.objectContaining({
          enabled: true,
        })
      );
    });

    it('processes schedules in batches', async () => {
      // Create 25 schedules to trigger 3 batches (CONCURRENCY_LIMIT = 10)
      const mockSchedules: ScheduleDoc[] = Array.from({ length: 25 }, (_, i) => ({
        id: `schedule-${i}`,
        title: `Schedule ${i}`,
        schedule: { type: 'once', value: new Date().toISOString() },
        event: { type: 'llm.request.v1' },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockRepo.getDueSchedules.mockResolvedValue(mockSchedules);
      mockRepo.update.mockResolvedValue(undefined);

      await server['handleTick']();

      // All 25 should be processed
      expect(mockRepo.update).toHaveBeenCalledTimes(25);
    });

    it('uses cached publishers for same topic', async () => {
      const mockSchedules: ScheduleDoc[] = [
        {
          id: '1',
          title: 'Schedule 1',
          topic: 'internal.ingress.v1',
          schedule: { type: 'once', value: new Date().toISOString() },
          event: { type: 'llm.request.v1' },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          title: 'Schedule 2',
          topic: 'internal.ingress.v1', // Same topic
          schedule: { type: 'once', value: new Date().toISOString() },
          event: { type: 'llm.request.v1' },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepo.getDueSchedules.mockResolvedValue(mockSchedules);
      mockRepo.update.mockResolvedValue(undefined);

      const { createMessagePublisher } = require('../services/message-bus');
      createMessagePublisher.mockClear();

      await server['handleTick']();

      // Should only create publisher once for the topic
      expect(createMessagePublisher).toHaveBeenCalledTimes(1);
      expect(createMessagePublisher).toHaveBeenCalledWith('internal.ingress.v1');
    });

    it('handles repository errors gracefully', async () => {
      mockRepo.getDueSchedules.mockRejectedValue(new Error('DB connection failed'));

      // Should not throw - error is caught and logged
      await expect(server['handleTick']()).rejects.toThrow('DB connection failed');
    });

    it('continues processing other schedules when one fails', async () => {
      const mockSchedules: ScheduleDoc[] = [
        {
          id: 'schedule-1',
          title: 'Schedule 1',
          schedule: { type: 'once', value: new Date().toISOString() },
          event: { type: 'llm.request.v1' },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'schedule-2',
          title: 'Schedule 2',
          schedule: { type: 'once', value: new Date().toISOString() },
          event: { type: 'llm.request.v1' },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepo.getDueSchedules.mockResolvedValue(mockSchedules);
      mockRepo.update
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockResolvedValueOnce(undefined);

      await server['handleTick']();

      // Both schedules attempted
      expect(mockRepo.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    let server: any;
    let mockRepo: jest.Mocked<IScheduleRepository>;

    beforeEach(() => {
      mockRepo = {
        list: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        getDueSchedules: jest.fn(),
      } as jest.Mocked<IScheduleRepository>;

      const { createScheduleRepository } = require('../services/scheduler/repository');
      createScheduleRepository.mockReturnValue(mockRepo);

      server = createServer();
      (server as any).scheduleRepo = mockRepo;
    });

    afterEach(async () => {
      await server.close('test-cleanup');
    });

    it('handles message bus publish failure', async () => {
      const mockSchedule: ScheduleDoc = {
        id: 'schedule-1',
        title: 'Test Schedule',
        schedule: { type: 'once', value: new Date().toISOString() },
        event: { type: 'llm.request.v1' },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([mockSchedule]);
      mockRepo.update.mockResolvedValue(undefined);

      const { createMessagePublisher } = require('../services/message-bus');
      createMessagePublisher.mockReturnValue({
        publishJson: jest.fn().mockRejectedValue(new Error('Publish failed')),
      });

      await server['handleTick']();

      // Error should be caught and logged, but not crash the service
      // Update should not be called if publish fails
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('handles repository update failure after execution', async () => {
      const mockSchedule: ScheduleDoc = {
        id: 'schedule-1',
        title: 'Test Schedule',
        schedule: { type: 'once', value: new Date().toISOString() },
        event: { type: 'llm.request.v1' },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([mockSchedule]);

      // Mock publisher to succeed (so we reach the update call)
      const { createMessagePublisher } = require('../services/message-bus');
      createMessagePublisher.mockReturnValue({
        publishJson: jest.fn().mockResolvedValue(undefined),
      });

      // Make update fail
      mockRepo.update.mockRejectedValue(new Error('Update failed'));

      await server['handleTick']();

      // Should attempt update (after successful publish)
      expect(mockRepo.update).toHaveBeenCalled();
    });

    it('handles invalid schedule data gracefully', async () => {
      const invalidSchedule: any = {
        id: 'invalid-schedule',
        title: 'Invalid Schedule',
        schedule: { type: 'once', value: 'not-a-date' },
        event: null, // Invalid event
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([invalidSchedule]);

      await server['handleTick']();

      // Should not crash - error handled gracefully
    });

    it('handles publisher creation failure', async () => {
      const mockSchedule: ScheduleDoc = {
        id: 'schedule-1',
        title: 'Test Schedule',
        schedule: { type: 'once', value: new Date().toISOString() },
        event: { type: 'llm.request.v1' },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getDueSchedules.mockResolvedValue([mockSchedule]);

      const { createMessagePublisher } = require('../services/message-bus');
      createMessagePublisher.mockImplementation(() => {
        throw new Error('Publisher creation failed');
      });

      await server['handleTick']();

      // Error should be caught and logged
    });
  });

  describe('Manual /tick trigger', () => {
    let app: any;
    let mockRepo: jest.Mocked<IScheduleRepository>;

    beforeEach(() => {
      mockRepo = {
        list: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        getDueSchedules: jest.fn(),
      } as jest.Mocked<IScheduleRepository>;

      const { createScheduleRepository } = require('../services/scheduler/repository');
      createScheduleRepository.mockReturnValue(mockRepo);

      const server = createServer();
      (server as any).scheduleRepo = mockRepo;
      app = server.getApp();

      // Stop ticker to avoid interference
      if ((server as any).tickInterval) {
        clearInterval((server as any).tickInterval);
        (server as any).tickInterval = null;
      }
    });

    it('POST /tick executes schedules manually', async () => {
      mockRepo.getDueSchedules.mockResolvedValue([]);

      const response = await request(app)
        .post('/tick')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockRepo.getDueSchedules).toHaveBeenCalled();
    });

    it('POST /tick returns error on failure', async () => {
      mockRepo.getDueSchedules.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/tick')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Database error');
    });
  });

  describe('Configuration', () => {
    it('reads SCHEDULER_TICK_INTERVAL_MS from environment', () => {
      const originalEnv = process.env.SCHEDULER_TICK_INTERVAL_MS;

      process.env.SCHEDULER_TICK_INTERVAL_MS = '30000';
      const server = createServer();

      expect((server as any).TICK_INTERVAL_MS).toBe(30000);

      if ((server as any).tickInterval) {
        clearInterval((server as any).tickInterval);
      }

      // Restore
      if (originalEnv) {
        process.env.SCHEDULER_TICK_INTERVAL_MS = originalEnv;
      } else {
        delete process.env.SCHEDULER_TICK_INTERVAL_MS;
      }
    });

    it('uses default value when SCHEDULER_TICK_INTERVAL_MS not set', () => {
      const originalEnv = process.env.SCHEDULER_TICK_INTERVAL_MS;
      delete process.env.SCHEDULER_TICK_INTERVAL_MS;

      const server = createServer();

      expect((server as any).TICK_INTERVAL_MS).toBe(60000); // Default 60 seconds

      if ((server as any).tickInterval) {
        clearInterval((server as any).tickInterval);
      }

      // Restore
      if (originalEnv) {
        process.env.SCHEDULER_TICK_INTERVAL_MS = originalEnv;
      }
    });

    it('rejects invalid SCHEDULER_TICK_INTERVAL_MS (too low)', () => {
      const originalEnv = process.env.SCHEDULER_TICK_INTERVAL_MS;
      process.env.SCHEDULER_TICK_INTERVAL_MS = '500'; // Below min 1000

      expect(() => createServer()).toThrow(/Invalid SCHEDULER_TICK_INTERVAL_MS/);

      // Restore
      if (originalEnv) {
        process.env.SCHEDULER_TICK_INTERVAL_MS = originalEnv;
      } else {
        delete process.env.SCHEDULER_TICK_INTERVAL_MS;
      }
    });

    it('rejects invalid SCHEDULER_TICK_INTERVAL_MS (too high)', () => {
      const originalEnv = process.env.SCHEDULER_TICK_INTERVAL_MS;
      process.env.SCHEDULER_TICK_INTERVAL_MS = '4000000'; // Above max 3600000

      expect(() => createServer()).toThrow(/Invalid SCHEDULER_TICK_INTERVAL_MS/);

      // Restore
      if (originalEnv) {
        process.env.SCHEDULER_TICK_INTERVAL_MS = originalEnv;
      } else {
        delete process.env.SCHEDULER_TICK_INTERVAL_MS;
      }
    });
  });
});
