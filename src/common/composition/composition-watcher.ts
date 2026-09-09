import { Bit } from '../base-server';
import { CompositionRegistry } from './registry';
import { CompiledComposition } from './types';

/**
 * Configuration options for CompositionWatcher
 *
 * Sprint 42: Enables hot-reloading of compositions without service restart
 */
export interface CompositionWatcherOptions {
  /** CompositionRegistry instance to query compositions */
  registry: CompositionRegistry;

  /** Callback when a new composition is added to the database */
  onCompositionAdded: (composition: CompiledComposition) => Promise<void>;

  /** Callback when a composition is removed from the database */
  onCompositionRemoved: (name: string, version: number) => Promise<void>;

  /** Callback when a composition is updated (content hash changed) */
  onCompositionUpdated: (composition: CompiledComposition) => Promise<void>;

  /** Poll interval in milliseconds (default: 30000 = 30 seconds) */
  pollInterval?: number;
}

/**
 * CompositionWatcher - Monitors compositions table for changes
 *
 * Polls the compositions table at regular intervals and detects:
 * - Additions: New compositions inserted
 * - Updates: Existing compositions modified (content hash changed)
 * - Deletions: Compositions removed
 *
 * Follows the same pattern as RegistryWatcher for MCP server discovery.
 *
 * Usage:
 * ```typescript
 * const watcher = new CompositionWatcher(bitInstance, {
 *   registry: compositionRegistry,
 *   onCompositionAdded: async (comp) => { ... },
 *   onCompositionUpdated: async (comp) => { ... },
 *   onCompositionRemoved: async (name, ver) => { ... },
 *   pollInterval: 30000
 * });
 * watcher.start();
 * ```
 *
 * Sprint 42: Hot-reload enhancement for composition subsystem
 */
export class CompositionWatcher {
  private unsubscribe?: () => void;
  private logger: any;
  private previousCompositions: Map<string, CompiledComposition> = new Map();

  constructor(
    private server: Bit,
    private options: CompositionWatcherOptions
  ) {
    this.logger = (server as any).getLogger();
  }

  /**
   * Start watching for composition changes
   *
   * Begins polling the compositions table at the configured interval.
   * Detects additions, updates, and deletions.
   */
  start() {
    const pollInterval = this.options.pollInterval || 30000;

    this.logger.info('composition_watcher.starting', {
      pollInterval,
    });

    // Poll function to check for changes
    const poll = async () => {
      try {
        // Get current compositions from registry
        const current = await this.options.registry.list();

        this.logger.debug('composition_watcher.snapshot_received', {
          count: current.length,
        });

        // Track current composition IDs (format: "name:version")
        const currentIds = new Set(current.map((c) => `${c.name}:${c.version}`));
        const previousIds = new Set(this.previousCompositions.keys());

        // Detect removals (compositions in previous snapshot but not in current)
        for (const id of previousIds) {
          if (!currentIds.has(id)) {
            const [name, versionStr] = id.split(':');
            const version = parseInt(versionStr, 10);

            this.logger.info('composition_watcher.removed', { name, version });

            // Invoke removal callback
            await this.options
              .onCompositionRemoved(name, version)
              .catch((error) => {
                this.logger.error('composition_watcher.remove_handler_error', {
                  name,
                  version,
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined,
                });
              });

            this.previousCompositions.delete(id);
          }
        }

        // Detect additions and updates
        for (const record of current) {
          const id = `${record.name}:${record.version}`;
          const previous = this.previousCompositions.get(id);

          if (!previous) {
            // New composition (not in previous snapshot)
            this.logger.info('composition_watcher.added', {
              name: record.name,
              version: record.version,
            });

            // Invoke addition callback
            await this.options
              .onCompositionAdded(record.compiled)
              .catch((error) => {
                this.logger.error('composition_watcher.add_handler_error', {
                  name: record.name,
                  version: record.version,
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined,
                });
              });

            this.previousCompositions.set(id, record.compiled);
          } else {
            // Check if updated (compare content hash)
            const contentChanged = record.contentHash !== previous.contentHash;

            if (contentChanged) {
              this.logger.info('composition_watcher.updated', {
                name: record.name,
                version: record.version,
                oldHash: previous.contentHash,
                newHash: record.contentHash,
              });

              // Invoke update callback
              await this.options
                .onCompositionUpdated(record.compiled)
                .catch((error) => {
                  this.logger.error('composition_watcher.update_handler_error', {
                    name: record.name,
                    version: record.version,
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                  });
                });

              this.previousCompositions.set(id, record.compiled);
            }
          }
        }
      } catch (err) {
        // Log snapshot processing error but don't crash the watcher
        // This ensures the watcher continues polling even if one cycle fails
        this.logger.error('composition_watcher.snapshot_error', {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    };

    // Set up polling interval
    const intervalId = setInterval(poll, pollInterval);

    // Create unsubscribe function
    this.unsubscribe = () => {
      clearInterval(intervalId);
    };

    this.logger.info('composition_watcher.started');
  }

  /**
   * Stop watching for composition changes
   *
   * Stops the polling and unsubscribes from the DocumentStore watch.
   */
  stop() {
    this.logger.info('composition_watcher.stopping');

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    this.logger.info('composition_watcher.stopped');
  }
}
