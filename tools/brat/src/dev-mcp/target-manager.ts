/**
 * Target Connection Manager
 *
 * Manages connections to deployment targets (local, SSH, GCP).
 * Reuses existing connection resolution logic from backup/connection.ts.
 */

import { TargetConnection } from './types.js';
import { Logger } from '../orchestration/logger';
import { resolveBackupConnection } from '../backup/connection';
import { getBackupFirestore } from '../providers/gcp/firestore';

/**
 * Manages target connections with pooling and cleanup
 */
export class TargetConnectionManager {
  private connections: Map<string, TargetConnection> = new Map();
  private defaultTarget?: string;
  private logger: Logger;

  constructor(defaultTarget: string | undefined, logger: Logger) {
    this.defaultTarget = defaultTarget;
    this.logger = logger;
  }

  /**
   * Get active connection for a target (creates if needed, caches for reuse)
   */
  async getActiveConnection(targetName?: string): Promise<TargetConnection> {
    const target = targetName || this.defaultTarget;

    // Check cache
    if (target && this.connections.has(target)) {
      this.logger.debug({ target }, 'Reusing cached connection');
      return this.connections.get(target)!;
    }

    // Create new connection
    this.logger.info({ target }, 'Establishing new connection');
    const connection = await this.connect(target);

    // Cache it
    if (target) {
      this.connections.set(target, connection);
    }

    return connection;
  }

  /**
   * Connect to a deployment target
   */
  private async connect(targetName?: string): Promise<TargetConnection> {
    try {
      // Resolve connection using existing backup connection logic
      const resolved = await resolveBackupConnection(
        {},
        { target: targetName || '' },
        this.logger
      );

      // Get Firestore instance
      const { db, target } = getBackupFirestore(resolved.connectOptions, this.logger);

      // Determine target type
      const type: TargetConnection['type'] = resolved.targetKind === 'remote'
        ? 'remote-ssh'
        : resolved.isEmulator
        ? 'local'
        : 'gcp';

      // Build TargetConnection
      const connection: TargetConnection = {
        name: targetName || 'default',
        type,
        firestore: {
          db,
          projectId: target.projectId,
          databaseId: target.databaseId,
        },
        cleanup: async () => {
          if (resolved.cleanup) {
            await resolved.cleanup();
          }
        },
      };

      // TODO: Resolve gateway URL for fleet operations
      // This would involve reading the registry to find tool-gateway URL
      // For now, we'll add this in DM-201 when implementing fleet tools

      this.logger.info({
        target: connection.name,
        type: connection.type,
        projectId: connection.firestore.projectId,
      }, 'Connection established');

      return connection;
    } catch (error: any) {
      this.logger.error({
        target: targetName,
        error: error.message,
      }, 'Failed to connect to target');
      throw new Error(`Failed to connect to target '${targetName}': ${error.message}`);
    }
  }

  /**
   * Health check for a connection
   */
  async healthCheck(connection: TargetConnection): Promise<boolean> {
    try {
      // Simple Firestore health check: list collections
      await connection.firestore.db.listCollections();
      return true;
    } catch (error) {
      this.logger.warn({
        target: connection.name,
        error: (error as Error).message,
      }, 'Health check failed');
      return false;
    }
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
