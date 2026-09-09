import { SnapshotManager, type WindowState } from './snapshot-manager';
import { RxJSWindowManager } from './rxjs-window-manager';
import type { IDocumentStore } from '../../common/persistence/interfaces';

/**
 * Crash Recovery Integration Tests
 *
 * Tests end-to-end crash recovery flows with SnapshotManager + RxJSWindowManager.
 * Sprint: sprint-20-xc3pcu (Phase 3)
 * Task: P3-004
 */

// Mock IDocumentStore
const createMockDocumentStore = (): jest.Mocked<IDocumentStore> => ({
  set: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue([]),
  get: jest.fn().mockResolvedValue(null),
  delete: jest.fn().mockResolvedValue(undefined)
} as any);

// Mock logger
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

describe('Crash Recovery Integration', () => {
  let mockStore: jest.Mocked<IDocumentStore>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockStore = createMockDocumentStore();
    mockLogger = createMockLogger();
  });

  describe('Mid-Window Crash Recovery', () => {
    it('should restore window states after crash', async () => {
      // Simulate window states before crash
      const windowStates = new Map<string, WindowState>([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2', 'evt-3'],
          eventCount: 3,
          windowStartedAt: new Date(Date.now() - 240000).toISOString(), // 4 min ago
          lastEventAt: new Date(Date.now() - 120000).toISOString(),     // 2 min ago
          snapshotAt: new Date(Date.now() - 60000).toISOString()        // 1 min ago
        }]
      ]);

      // Take snapshot
      const snapshotManager1 = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000
      });

      await snapshotManager1.takeSnapshot(windowStates);

      // Verify snapshot was saved
      expect(mockStore.set).toHaveBeenCalledWith(
        'window_snapshots',
        'observer-1',
        expect.objectContaining({
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2', 'evt-3'],
          eventCount: 3
        })
      );

      // Simulate crash and restart
      const savedSnapshot = mockStore.set.mock.calls[0][2] as WindowState;

      mockStore.query.mockResolvedValueOnce([savedSnapshot]);

      // New instance after restart
      const snapshotManager2 = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000
      });

      const restored = await snapshotManager2.restoreWindows();

      // Verify restoration
      expect(restored.size).toBe(1);
      expect(restored.get('observer-1')).toMatchObject({
        observerId: 'observer-1',
        eventIds: ['evt-1', 'evt-2', 'evt-3'],
        eventCount: 3
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'snapshot-manager.restore.complete',
        {
          totalSnapshots: 1,
          restoredWindows: 1,
          discardedStale: 0
        }
      );
    });

    it('should handle max 5-min data loss window', async () => {
      // Snapshot taken 4 minutes ago
      const oldSnapshot: WindowState = {
        observerId: 'observer-1',
        eventIds: ['evt-1', 'evt-2'],
        eventCount: 2,
        windowStartedAt: new Date(Date.now() - 300000).toISOString(), // 5 min ago
        lastEventAt: new Date(Date.now() - 240000).toISOString(),     // 4 min ago
        snapshotAt: new Date(Date.now() - 240000).toISOString()       // 4 min ago
      };

      // Events evt-3, evt-4, evt-5 were added after snapshot (lost on crash)

      mockStore.query.mockResolvedValueOnce([oldSnapshot]);

      const snapshotManager = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000
      });

      const restored = await snapshotManager.restoreWindows();

      // Only events from snapshot restored (evt-1, evt-2)
      expect(restored.size).toBe(1);
      expect(restored.get('observer-1')?.eventIds).toEqual(['evt-1', 'evt-2']);
      expect(restored.get('observer-1')?.eventCount).toBe(2);
    });
  });

  describe('Graceful Shutdown Recovery', () => {
    it('should restore all events with zero data loss', async () => {
      // Window states at shutdown
      const finalStates = new Map<string, WindowState>([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2', 'evt-3', 'evt-4'],
          eventCount: 4,
          windowStartedAt: new Date(Date.now() - 180000).toISOString(),
          lastEventAt: new Date().toISOString(),
          snapshotAt: new Date().toISOString()
        }]
      ]);

      // Graceful shutdown: take final snapshot
      const snapshotManager1 = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000
      });

      await snapshotManager1.takeSnapshot(finalStates);

      const finalSnapshot = mockStore.set.mock.calls[0][2] as WindowState;

      // Restart
      mockStore.query.mockResolvedValueOnce([finalSnapshot]);

      const snapshotManager2 = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000
      });

      const restored = await snapshotManager2.restoreWindows();

      // Verify zero data loss
      expect(restored.get('observer-1')?.eventCount).toBe(4);
      expect(restored.get('observer-1')?.eventIds).toHaveLength(4);
    });
  });

  describe('Cold Start', () => {
    it('should initialize cleanly with no snapshots', async () => {
      mockStore.query.mockResolvedValueOnce([]); // No snapshots

      const snapshotManager = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000
      });

      const restored = await snapshotManager.restoreWindows();

      expect(restored.size).toBe(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'snapshot-manager.restore.complete',
        {
          totalSnapshots: 0,
          restoredWindows: 0,
          discardedStale: 0
        }
      );
    });
  });

  describe('Stale Snapshot Handling', () => {
    it('should discard snapshots older than stale threshold (10 min)', async () => {
      const staleSnapshot: WindowState = {
        observerId: 'observer-1',
        eventIds: ['evt-old-1', 'evt-old-2'],
        eventCount: 2,
        windowStartedAt: new Date(Date.now() - 900000).toISOString(),  // 15 min ago
        lastEventAt: new Date(Date.now() - 900000).toISOString(),
        snapshotAt: new Date(Date.now() - 900000).toISOString()        // 15 min ago (STALE)
      };

      mockStore.query.mockResolvedValueOnce([staleSnapshot]);

      const snapshotManager = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000 // 10 minutes
      });

      const restored = await snapshotManager.restoreWindows();

      // Stale snapshot discarded
      expect(restored.size).toBe(0);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'snapshot-manager.restore.stale',
        expect.objectContaining({
          observerId: 'observer-1',
          ageMs: expect.any(Number),
          ageMinutes: expect.any(Number)
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'snapshot-manager.restore.complete',
        {
          totalSnapshots: 1,
          restoredWindows: 0,
          discardedStale: 1
        }
      );
    });

    it('should restore fresh snapshots within threshold', async () => {
      const freshSnapshot: WindowState = {
        observerId: 'observer-1',
        eventIds: ['evt-1', 'evt-2', 'evt-3'],
        eventCount: 3,
        windowStartedAt: new Date(Date.now() - 300000).toISOString(),  // 5 min ago
        lastEventAt: new Date(Date.now() - 120000).toISOString(),
        snapshotAt: new Date(Date.now() - 300000).toISOString()        // 5 min ago (FRESH)
      };

      mockStore.query.mockResolvedValueOnce([freshSnapshot]);

      const snapshotManager = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000 // 10 minutes
      });

      const restored = await snapshotManager.restoreWindows();

      // Fresh snapshot restored
      expect(restored.size).toBe(1);
      expect(restored.get('observer-1')?.eventCount).toBe(3);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'snapshot-manager.restore.complete',
        {
          totalSnapshots: 1,
          restoredWindows: 1,
          discardedStale: 0
        }
      );
    });
  });

  describe('RxJSWindowManager Integration', () => {
    it('should track and export window states for snapshots', () => {
      const windowManager = new RxJSWindowManager(mockLogger);

      // Simulate restored states
      const restoredStates = new Map<string, WindowState>([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2'],
          eventCount: 2,
          windowStartedAt: new Date().toISOString(),
          lastEventAt: new Date().toISOString(),
          snapshotAt: new Date().toISOString()
        }]
      ]);

      windowManager.restoreWindowStates(restoredStates);

      // Verify states can be retrieved
      const currentStates = windowManager.getAllWindowStates();

      expect(currentStates.size).toBe(1);
      expect(currentStates.get('observer-1')?.eventIds).toEqual(['evt-1', 'evt-2']);
      expect(currentStates.get('observer-1')?.eventCount).toBe(2);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'rxjs.window.restore_complete',
        {
          windowCount: 1,
          totalEvents: 2
        }
      );
    });
  });

  describe('Error Handling', () => {
    it('should fallback to cold start on restore error', async () => {
      mockStore.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const snapshotManager = new SnapshotManager(mockStore, mockLogger, {
        enabled: true,
        snapshotIntervalMs: 300000,
        staleThresholdMs: 600000
      });

      const restored = await snapshotManager.restoreWindows();

      // Graceful fallback
      expect(restored.size).toBe(0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'snapshot-manager.restore.error',
        expect.objectContaining({
          error: 'Database connection failed'
        })
      );
    });
  });
});
