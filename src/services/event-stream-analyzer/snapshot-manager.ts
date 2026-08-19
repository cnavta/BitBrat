import type { IDocumentStore } from '../../common/persistence/interfaces';

/**
 * WindowState represents the current state of an observer's event window
 * Stored in window_snapshots table for crash recovery
 */
export interface WindowState {
  observerId: string;
  eventIds: string[];          // Event correlation IDs currently in window
  eventCount: number;           // Number of events in window
  windowStartedAt: string;      // ISO8601 timestamp when window started
  lastEventAt: string;          // ISO8601 timestamp of most recent event
  snapshotAt: string;           // ISO8601 timestamp when snapshot was created
}

/**
 * SnapshotManager Configuration
 */
export interface SnapshotManagerConfig {
  snapshotIntervalMs: number;    // How often to take snapshots (default: 300000 = 5 min)
  enabled: boolean;               // Enable/disable snapshots (default: true)
  staleThresholdMs?: number;      // Max age for snapshot to be considered valid (default: 600000 = 10 min)
}

/**
 * SnapshotManager
 *
 * Manages periodic window state snapshots to PostgreSQL for crash recovery.
 * Enables service to restore windows after restart with max 5-min data loss.
 *
 * Phase 3: Production Readiness - Snapshot & Recovery
 * Sprint: sprint-20-xc3pcu
 * Task: P3-002
 */
export class SnapshotManager {
  private snapshotTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private documentStore: IDocumentStore,
    private logger: any,
    private config: SnapshotManagerConfig
  ) {}

  /**
   * Start periodic snapshot loop
   * Called during service startup after observers are loaded
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('snapshot-manager.start.already_running');
      return;
    }

    if (!this.config.enabled) {
      this.logger.info('snapshot-manager.start.disabled');
      return;
    }

    this.isRunning = true;
    this.logger.info('snapshot-manager.start', {
      intervalMs: this.config.snapshotIntervalMs,
      intervalMinutes: Math.round(this.config.snapshotIntervalMs / 60000)
    });

    // Start periodic snapshot loop
    this.snapshotTimer = setInterval(async () => {
      this.logger.debug('snapshot-manager.tick');
      // Snapshot will be triggered externally via takeSnapshot()
      // This timer is a placeholder for future auto-snapshot logic
    }, this.config.snapshotIntervalMs);
  }

  /**
   * Stop snapshot loop (graceful shutdown)
   * Called during service shutdown
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.debug('snapshot-manager.stop.not_running');
      return;
    }

    this.logger.info('snapshot-manager.stop');

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    this.isRunning = false;
  }

  /**
   * Take immediate snapshot of all windows
   * Called by service on periodic timer or graceful shutdown
   *
   * @param windowStates Map of observerId → WindowState
   */
  async takeSnapshot(windowStates: Map<string, WindowState>): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('snapshot-manager.snapshot.disabled');
      return;
    }

    const startTime = Date.now();
    const observerIds = Array.from(windowStates.keys());

    this.logger.info('snapshot-manager.snapshot.start', {
      windowCount: observerIds.length
    });

    try {
      // Upsert snapshots for each observer
      const results = await Promise.allSettled(
        observerIds.map(observerId =>
          this.saveWindowSnapshot(windowStates.get(observerId)!)
        )
      );

      // Count successes and failures
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      const latencyMs = Date.now() - startTime;

      this.logger.info('snapshot-manager.snapshot.complete', {
        windowCount: observerIds.length,
        succeeded,
        failed,
        latencyMs
      });

      // Log failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.logger.error('snapshot-manager.snapshot.failed', {
            observerId: observerIds[index],
            error: result.reason?.message || result.reason
          });
        }
      });

    } catch (error: any) {
      this.logger.error('snapshot-manager.snapshot.error', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Save single window snapshot to database
   * Uses IDocumentStore for platform-agnostic persistence
   *
   * @param state WindowState to persist
   */
  private async saveWindowSnapshot(state: WindowState): Promise<void> {
    try {
      // Store in window_snapshots table (uses IDocumentStore abstraction)
      // set() with no merge parameter replaces entire document (upsert behavior)
      await this.documentStore.set('window_snapshots', state.observerId, state);

      this.logger.debug('snapshot-manager.save', {
        observerId: state.observerId,
        eventCount: state.eventCount,
        eventIds: state.eventIds.length
      });
    } catch (error: any) {
      this.logger.error('snapshot-manager.save.error', {
        observerId: state.observerId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Restore windows from last snapshot
   * Called during service startup before creating new windows
   *
   * @returns Map of observerId → WindowState
   */
  async restoreWindows(): Promise<Map<string, WindowState>> {
    if (!this.config.enabled) {
      this.logger.info('snapshot-manager.restore.disabled');
      return new Map();
    }

    this.logger.info('snapshot-manager.restore.start');

    try {
      // Query all snapshots from window_snapshots table
      const snapshots = await this.documentStore.query<WindowState>('window_snapshots', {});

      const restoredWindows = new Map<WindowState['observerId'], WindowState>();
      const now = Date.now();
      const staleThreshold = this.config.staleThresholdMs || 600000; // 10 minutes

      for (const snapshot of snapshots) {
        const snapshotAge = now - new Date(snapshot.snapshotAt).getTime();

        // Discard stale snapshots (older than threshold)
        if (snapshotAge > staleThreshold) {
          this.logger.warn('snapshot-manager.restore.stale', {
            observerId: snapshot.observerId,
            ageMs: snapshotAge,
            ageMinutes: Math.round(snapshotAge / 60000),
            thresholdMinutes: Math.round(staleThreshold / 60000)
          });
          continue;
        }

        restoredWindows.set(snapshot.observerId, snapshot);

        this.logger.debug('snapshot-manager.restore.window', {
          observerId: snapshot.observerId,
          eventCount: snapshot.eventCount,
          ageMs: snapshotAge,
          ageMinutes: Math.round(snapshotAge / 60000)
        });
      }

      this.logger.info('snapshot-manager.restore.complete', {
        totalSnapshots: snapshots.length,
        restoredWindows: restoredWindows.size,
        discardedStale: snapshots.length - restoredWindows.size
      });

      return restoredWindows;

    } catch (error: any) {
      this.logger.error('snapshot-manager.restore.error', {
        error: error.message,
        stack: error.stack
      });
      // Return empty map on error (cold start fallback)
      return new Map();
    }
  }

  /**
   * Get current snapshot manager status
   * Used for health checks and monitoring
   */
  getStatus(): {
    enabled: boolean;
    running: boolean;
    intervalMs: number;
  } {
    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      intervalMs: this.config.snapshotIntervalMs
    };
  }
}
