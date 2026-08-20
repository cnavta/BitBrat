import { SnapshotManager, type WindowState, type SnapshotManagerConfig } from './snapshot-manager';
import type { IDocumentStore } from '../../common/persistence/interfaces';

// Mock IDocumentStore
const createMockDocumentStore = (): jest.Mocked<IDocumentStore> => ({
  set: jest.fn(),
  query: jest.fn(),
  get: jest.fn(),
  delete: jest.fn()
} as any);

// Mock logger
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

describe('SnapshotManager', () => {
  let mockStore: jest.Mocked<IDocumentStore>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let manager: SnapshotManager;

  const defaultConfig: SnapshotManagerConfig = {
    enabled: true,
    snapshotIntervalMs: 300000, // 5 minutes
    staleThresholdMs: 600000    // 10 minutes
  };

  beforeEach(() => {
    mockStore = createMockDocumentStore();
    mockLogger = createMockLogger();
    manager = new SnapshotManager(mockStore, mockLogger, defaultConfig);
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('start()', () => {
    it('should start snapshot manager when enabled', async () => {
      await manager.start();

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.start', {
        intervalMs: 300000,
        intervalMinutes: 5
      });

      const status = manager.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.running).toBe(true);
      expect(status.intervalMs).toBe(300000);
    });

    it('should not start when disabled', async () => {
      const disabledManager = new SnapshotManager(mockStore, mockLogger, {
        ...defaultConfig,
        enabled: false
      });

      await disabledManager.start();

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.start.disabled');
      expect(disabledManager.getStatus().running).toBe(false);
    });

    it('should not start twice', async () => {
      await manager.start();
      await manager.start();

      expect(mockLogger.warn).toHaveBeenCalledWith('snapshot-manager.start.already_running');
    });
  });

  describe('stop()', () => {
    it('should stop snapshot manager', async () => {
      await manager.start();
      await manager.stop();

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.stop');
      expect(manager.getStatus().running).toBe(false);
    });

    it('should handle stop when not running', async () => {
      await manager.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith('snapshot-manager.stop.not_running');
    });
  });

  describe('takeSnapshot()', () => {
    it('should save snapshots for all windows', async () => {
      const windowStates = new Map<string, WindowState>([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2', 'evt-3'],
          eventCount: 3,
          windowStartedAt: '2026-08-19T12:00:00.000Z',
          lastEventAt: '2026-08-19T12:04:30.000Z',
          snapshotAt: new Date().toISOString()
        }],
        ['observer-2', {
          observerId: 'observer-2',
          eventIds: ['evt-4', 'evt-5'],
          eventCount: 2,
          windowStartedAt: '2026-08-19T12:01:00.000Z',
          lastEventAt: '2026-08-19T12:03:00.000Z',
          snapshotAt: new Date().toISOString()
        }]
      ]);

      mockStore.set.mockResolvedValue(undefined);

      await manager.takeSnapshot(windowStates);

      expect(mockStore.set).toHaveBeenCalledTimes(2);
      expect(mockStore.set).toHaveBeenCalledWith(
        'window_snapshots',
        'observer-1',
        windowStates.get('observer-1')
      );
      expect(mockStore.set).toHaveBeenCalledWith(
        'window_snapshots',
        'observer-2',
        windowStates.get('observer-2')
      );

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.snapshot.complete', {
        windowCount: 2,
        succeeded: 2,
        failed: 0,
        latencyMs: expect.any(Number)
      });
    });

    it('should handle partial failures gracefully', async () => {
      const windowStates = new Map<string, WindowState>([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1'],
          eventCount: 1,
          windowStartedAt: '2026-08-19T12:00:00.000Z',
          lastEventAt: '2026-08-19T12:01:00.000Z',
          snapshotAt: new Date().toISOString()
        }],
        ['observer-2', {
          observerId: 'observer-2',
          eventIds: ['evt-2'],
          eventCount: 1,
          windowStartedAt: '2026-08-19T12:00:00.000Z',
          lastEventAt: '2026-08-19T12:01:00.000Z',
          snapshotAt: new Date().toISOString()
        }]
      ]);

      // First succeeds, second fails
      mockStore.set
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Database error'));

      await manager.takeSnapshot(windowStates);

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.snapshot.complete', {
        windowCount: 2,
        succeeded: 1,
        failed: 1,
        latencyMs: expect.any(Number)
      });

      expect(mockLogger.error).toHaveBeenCalledWith('snapshot-manager.snapshot.failed', {
        observerId: 'observer-2',
        error: 'Database error'
      });
    });

    it('should skip snapshot when disabled', async () => {
      const disabledManager = new SnapshotManager(mockStore, mockLogger, {
        ...defaultConfig,
        enabled: false
      });

      const windowStates = new Map<string, WindowState>();
      await disabledManager.takeSnapshot(windowStates);

      expect(mockStore.set).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('snapshot-manager.snapshot.disabled');
    });

    it('should handle empty window states', async () => {
      const windowStates = new Map<string, WindowState>();

      await manager.takeSnapshot(windowStates);

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.snapshot.start', {
        windowCount: 0
      });
      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.snapshot.complete', {
        windowCount: 0,
        succeeded: 0,
        failed: 0,
        latencyMs: expect.any(Number)
      });
    });
  });

  describe('restoreWindows()', () => {
    it('should restore valid snapshots', async () => {
      const now = new Date();
      const snapshots: WindowState[] = [
        {
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2'],
          eventCount: 2,
          windowStartedAt: new Date(now.getTime() - 60000).toISOString(), // 1 min ago
          lastEventAt: new Date(now.getTime() - 30000).toISOString(),     // 30 sec ago
          snapshotAt: new Date(now.getTime() - 10000).toISOString()       // 10 sec ago
        },
        {
          observerId: 'observer-2',
          eventIds: ['evt-3'],
          eventCount: 1,
          windowStartedAt: new Date(now.getTime() - 120000).toISOString(),
          lastEventAt: new Date(now.getTime() - 60000).toISOString(),
          snapshotAt: new Date(now.getTime() - 20000).toISOString()        // 20 sec ago
        }
      ];

      mockStore.query.mockResolvedValue(snapshots);

      const restored = await manager.restoreWindows();

      expect(restored.size).toBe(2);
      expect(restored.get('observer-1')).toEqual(snapshots[0]);
      expect(restored.get('observer-2')).toEqual(snapshots[1]);

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.restore.complete', {
        totalSnapshots: 2,
        restoredWindows: 2,
        discardedStale: 0
      });
    });

    it('should discard stale snapshots', async () => {
      const now = new Date();
      const snapshots: WindowState[] = [
        {
          observerId: 'observer-1',
          eventIds: ['evt-1'],
          eventCount: 1,
          windowStartedAt: new Date(now.getTime() - 3600000).toISOString(), // 1 hour ago
          lastEventAt: new Date(now.getTime() - 3600000).toISOString(),
          snapshotAt: new Date(now.getTime() - 900000).toISOString() // 15 min ago (stale)
        },
        {
          observerId: 'observer-2',
          eventIds: ['evt-2'],
          eventCount: 1,
          windowStartedAt: new Date(now.getTime() - 60000).toISOString(),
          lastEventAt: new Date(now.getTime() - 30000).toISOString(),
          snapshotAt: new Date(now.getTime() - 10000).toISOString() // 10 sec ago (fresh)
        }
      ];

      mockStore.query.mockResolvedValue(snapshots);

      const restored = await manager.restoreWindows();

      expect(restored.size).toBe(1);
      expect(restored.has('observer-2')).toBe(true);
      expect(restored.has('observer-1')).toBe(false);

      expect(mockLogger.warn).toHaveBeenCalledWith('snapshot-manager.restore.stale', expect.objectContaining({
        observerId: 'observer-1',
        ageMs: expect.any(Number),
        ageMinutes: expect.any(Number)
      }));

      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.restore.complete', {
        totalSnapshots: 2,
        restoredWindows: 1,
        discardedStale: 1
      });
    });

    it('should return empty map when disabled', async () => {
      const disabledManager = new SnapshotManager(mockStore, mockLogger, {
        ...defaultConfig,
        enabled: false
      });

      const restored = await disabledManager.restoreWindows();

      expect(restored.size).toBe(0);
      expect(mockStore.query).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.restore.disabled');
    });

    it('should handle query errors gracefully (cold start fallback)', async () => {
      mockStore.query.mockRejectedValue(new Error('Database error'));

      const restored = await manager.restoreWindows();

      expect(restored.size).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith('snapshot-manager.restore.error', {
        error: 'Database error',
        stack: expect.any(String)
      });
    });

    it('should handle empty snapshots', async () => {
      mockStore.query.mockResolvedValue([]);

      const restored = await manager.restoreWindows();

      expect(restored.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('snapshot-manager.restore.complete', {
        totalSnapshots: 0,
        restoredWindows: 0,
        discardedStale: 0
      });
    });
  });

  describe('getStatus()', () => {
    it('should return correct status when enabled and running', async () => {
      await manager.start();

      const status = manager.getStatus();

      expect(status).toEqual({
        enabled: true,
        running: true,
        intervalMs: 300000
      });
    });

    it('should return correct status when enabled but not running', () => {
      const status = manager.getStatus();

      expect(status).toEqual({
        enabled: true,
        running: false,
        intervalMs: 300000
      });
    });

    it('should return correct status when disabled', () => {
      const disabledManager = new SnapshotManager(mockStore, mockLogger, {
        ...defaultConfig,
        enabled: false
      });

      const status = disabledManager.getStatus();

      expect(status).toEqual({
        enabled: false,
        running: false,
        intervalMs: 300000
      });
    });
  });
});
