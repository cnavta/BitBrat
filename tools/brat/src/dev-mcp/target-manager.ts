/**
 * Target Connection Manager
 *
 * Sprint 354: Refactored to use ContextResolver + ContextAdapter
 *
 * Manages connections to execution contexts with pooling and cleanup.
 * Delegates context resolution to platform-standard ContextResolver,
 * eliminating 143 lines of duplicated code.
 */

import { TargetConnection } from './types.js';
import { Logger } from '../orchestration/logger';
import { ContextResolver } from '../context/context-resolver.js';
import { ContextAdapter } from './adapters/context-adapter.js';

/**
 * Manages target connections with pooling and cleanup
 */
export class TargetConnectionManager {
  private connections: Map<string, TargetConnection> = new Map();
  private defaultContext?: string;
  private contextResolver: ContextResolver;
  private contextAdapter: ContextAdapter;
  private logger: Logger;

  constructor(
    repoRoot: string,
    defaultContext: string | undefined,
    logger: Logger
  ) {
    this.defaultContext = defaultContext;
    this.logger = logger;
    this.contextResolver = new ContextResolver(repoRoot);
    this.contextAdapter = new ContextAdapter(logger);
  }

  /**
   * Get active connection for a context (creates if needed, caches for reuse)
   *
   * @param contextName - Context name (optional, uses default if not provided)
   * @returns Target connection
   */
  async getActiveConnection(contextName?: string): Promise<TargetConnection> {
    // Resolve context name using ContextResolver priority:
    // 1. Explicit contextName parameter
    // 2. BITBRAT_CONTEXT env var
    // 3. ~/.bratrc current_context
    // 4. Default context from constructor
    // 5. Fallback to 'local'
    const resolved = await this.contextResolver.resolve(contextName || this.defaultContext);

    // Check cache
    if (this.connections.has(resolved.name)) {
      this.logger.debug({ context: resolved.name }, 'Reusing cached connection');
      return this.connections.get(resolved.name)!;
    }

    // Create new connection via adapter
    this.logger.info({ context: resolved.name }, 'Establishing new connection');
    const connection = await this.contextAdapter.createConnection(resolved);

    // Cache it
    this.connections.set(resolved.name, connection);

    return connection;
  }


  /**
   * Disconnect a specific target
   */
  async disconnect(targetName: string): Promise<void> {
    const connection = this.connections.get(targetName);
    if (connection) {
      this.logger.info({ target: targetName }, 'Disconnecting target');
      await connection.cleanup();
      this.connections.delete(targetName);
    }
  }

  /**
   * Disconnect all targets
   */
  async disconnectAll(): Promise<void> {
    this.logger.info({ count: this.connections.size }, 'Disconnecting all targets');
    await Promise.all(
      Array.from(this.connections.values()).map((conn) => conn.cleanup())
    );
    this.connections.clear();
  }
}
