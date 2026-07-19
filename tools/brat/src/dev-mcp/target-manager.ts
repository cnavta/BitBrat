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
  private defaultAuthToken?: string;
  private logger: Logger;

  constructor(defaultTarget: string | undefined, defaultAuthToken: string | undefined, logger: Logger) {
    this.defaultTarget = defaultTarget;
    this.defaultAuthToken = defaultAuthToken;
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
      // Load architecture.yaml first to determine persistence driver BEFORE attempting any connections
      let gateway: TargetConnection['gateway'];
      let ssh: TargetConnection['ssh'];
      let deploymentTarget: any;
      let persistenceDriver: 'postgres' | 'firestore' | undefined;
      let type: TargetConnection['type'] = 'local';

      if (targetName) {
        try {
          // Determine root directory (walk up to find architecture.yaml)
          const rootDir = this.findRootDir();
          const arch = loadArchitecture(rootDir);
          deploymentTarget = arch?.deploymentTargets?.[targetName];

          // Determine target type from deployment target config
          if (deploymentTarget) {
            if (deploymentTarget.host?.startsWith('ssh://')) {
              type = 'remote-ssh';
            } else if (deploymentTarget.type === 'docker-engine') {
              type = 'local';
            } else if (deploymentTarget.type === 'gcp') {
              type = 'gcp';
            }
          }

          // Determine persistence driver early so we can conditionally connect to Firestore
          if (deploymentTarget?.persistence?.driver) {
            persistenceDriver = deploymentTarget.persistence.driver as 'postgres' | 'firestore';
          } else {
            // Default: postgres for staging/production, firestore for local
            persistenceDriver = type === 'local' ? 'firestore' : 'postgres';
          }

          if (deploymentTarget) {
            // Extract gateway configuration
            if (deploymentTarget.gateway?.url) {
              gateway = {
                url: deploymentTarget.gateway.url,
                authToken: deploymentTarget.gateway.authToken || this.defaultAuthToken
              };
              this.logger.debug({ target: targetName, gatewayUrl: gateway.url, hasToken: !!gateway.authToken }, 'Resolved gateway URL from architecture.yaml');
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
      } else {
        // No target name specified - default to firestore for backward compatibility
        persistenceDriver = 'firestore';
      }

      // For local connections without explicit gateway config, use default local gateway
      if (!gateway && type === 'local' && this.defaultAuthToken) {
        gateway = {
          url: 'http://tool-gateway.bitbrat.local:3000',
          authToken: this.defaultAuthToken
        };
        this.logger.debug({ gatewayUrl: gateway.url }, 'Using default local gateway URL');
      }

      // Initialize persistence backend
      let store: any;
      let db: any;
      let target: any = { projectId: '', databaseId: '' };

      if (persistenceDriver === 'postgres') {
        // Initialize PostgreSQL store
        try {
          const { PostgresDocumentStore } = await import('../../../../src/common/persistence/postgres-store.js');

          let connectionString: string;

          // Construct DATABASE_URL from target config if available
          if (deploymentTarget?.persistence?.host) {
            const pgHost = deploymentTarget.persistence.host;
            const pgPort = deploymentTarget.persistence.port || 5432;
            const pgDatabase = deploymentTarget.persistence.database || 'bitbrat';
            const pgUsername = deploymentTarget.persistence.username || 'bitbrat';
            const pgPassword = deploymentTarget.persistence.password || '';

            connectionString = `postgresql://${pgUsername}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}`;
            this.logger.debug({
              target: targetName,
              driver: persistenceDriver,
              host: pgHost,
              port: pgPort,
              database: pgDatabase
            }, 'Constructed PostgreSQL connection string from target config');
          } else if (process.env.DATABASE_URL) {
            // Fall back to environment variable
            connectionString = process.env.DATABASE_URL;
            this.logger.debug({ target: targetName, driver: persistenceDriver }, 'Using DATABASE_URL from environment');
          } else {
            throw new Error(
              'PostgreSQL configuration not found. ' +
              'Either configure persistence.host in architecture.yaml deploymentTargets or set DATABASE_URL environment variable.'
            );
          }

          store = new PostgresDocumentStore({
            connectionString,
            poolSize: 5, // Smaller pool for dev-mcp tools
            ssl: false
          });
          this.logger.debug({ target: targetName, driver: persistenceDriver }, 'Initialized PostgreSQL DocumentStore');
        } catch (error: any) {
          this.logger.error({ target: targetName, error: error.message }, 'Failed to initialize PostgreSQL store');
          throw new Error(`PostgreSQL initialization failed for target '${targetName}': ${error.message}`);
        }
      }

      // Only connect to Firestore if using firestore driver
      let cleanupFn: (() => Promise<void>) | undefined;

      if (persistenceDriver === 'firestore') {
        try {
          // Only now resolve backup connection (which establishes Firestore connection)
          const resolved = await resolveBackupConnection(
            {},
            { target: targetName || '' },
            this.logger
          );

          const firestoreResult = getBackupFirestore(resolved.connectOptions, this.logger);
          db = firestoreResult.db;
          target = firestoreResult.target;
          cleanupFn = resolved.cleanup;
          this.logger.debug({ target: targetName, driver: persistenceDriver, projectId: target.projectId }, 'Connected to Firestore');
        } catch (error: any) {
          this.logger.error({ target: targetName, error: error.message }, 'Failed to connect to Firestore');
          throw new Error(`Failed to connect to Firestore for target '${targetName}': ${error.message}`);
        }
      }

      // Build TargetConnection
      const connection: TargetConnection = {
        name: targetName || 'default',
        type,
        persistenceDriver,
        store,
        firestore: {
          db,
          projectId: target.projectId,
          databaseId: target.databaseId,
        },
        gateway,
        ssh,
        cleanup: async () => {
          // Cleanup PostgreSQL connection pool if exists
          if (store && typeof store.close === 'function') {
            await store.close();
          }
          // Cleanup Firestore connection if exists
          if (cleanupFn) {
            await cleanupFn();
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
