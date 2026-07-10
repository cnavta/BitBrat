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
import { loadArchitecture } from '../config/loader';
import * as path from 'path';
import * as fs from 'fs';

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
   * Find root directory by walking up to find architecture.yaml
   */
  private findRootDir(): string {
    let currentDir = process.cwd();
    const maxDepth = 10;
    let depth = 0;

    while (depth < maxDepth) {
      const archPath = path.join(currentDir, 'architecture.yaml');
      if (fs.existsSync(archPath)) {
        return currentDir;
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        // Reached root
        break;
      }
      currentDir = parent;
      depth++;
    }

    // Default to current directory if not found
    return process.cwd();
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

      // Load architecture.yaml to get gateway URL and SSH details
      let gateway: TargetConnection['gateway'];
      let ssh: TargetConnection['ssh'];

      if (targetName) {
        try {
          // Determine root directory (walk up to find architecture.yaml)
          const rootDir = this.findRootDir();
          const arch = loadArchitecture(rootDir);
          const deploymentTarget = arch?.deploymentTargets?.[targetName];

          if (deploymentTarget) {
            // Extract gateway configuration
            if (deploymentTarget.gateway?.url) {
              gateway = {
                url: deploymentTarget.gateway.url,
                authToken: deploymentTarget.gateway.authToken
              };
              this.logger.debug({ target: targetName, gatewayUrl: gateway.url }, 'Resolved gateway URL from architecture.yaml');
            }

            // Extract SSH details for remote targets
            if (type === 'remote-ssh' && deploymentTarget.host?.startsWith('ssh://')) {
              const sshTarget = deploymentTarget.host.replace('ssh://', '');
              ssh = {
                target: sshTarget,
                remoteDir: deploymentTarget.remoteDir
              };
              this.logger.debug({ target: targetName, sshTarget: ssh.target, remoteDir: ssh.remoteDir }, 'Resolved SSH connection details');
            }
          }
        } catch (error: any) {
          this.logger.warn({ target: targetName, error: error.message }, 'Failed to load gateway/SSH config from architecture.yaml');
          // Continue without gateway/SSH details - not fatal
        }
      }

      // Build TargetConnection
      const connection: TargetConnection = {
        name: targetName || 'default',
        type,
        firestore: {
          db,
          projectId: target.projectId,
          databaseId: target.databaseId,
        },
        gateway,
        ssh,
        cleanup: async () => {
          if (resolved.cleanup) {
            await resolved.cleanup();
          }
        },
      };

      this.logger.info({
        target: connection.name,
        type: connection.type,
        projectId: connection.firestore.projectId,
        hasGateway: !!connection.gateway,
        hasSsh: !!connection.ssh
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
