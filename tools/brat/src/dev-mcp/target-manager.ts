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
import { SSHTunnelManager } from './ssh-tunnel.js';
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
  private sshTunnelManager: SSHTunnelManager;

  constructor(defaultTarget: string | undefined, defaultAuthToken: string | undefined, logger: Logger) {
    this.defaultTarget = defaultTarget;
    this.defaultAuthToken = defaultAuthToken;
    this.logger = logger;
    this.sshTunnelManager = new SSHTunnelManager(logger);
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
      let persistenceConfig: any;

      if (targetName) {
        try {
          // Determine root directory (walk up to find architecture.yaml)
          const rootDir = this.findRootDir();
          const arch = loadArchitecture(rootDir);
          // Sprint 349+: Use executionContexts instead of deploymentTargets
          deploymentTarget = arch?.executionContexts?.[targetName] || arch?.deploymentTargets?.[targetName];

          // Determine target type from deployment target config
          // Support both old (deploymentTargets) and new (executionContexts) structure
          const dockerHost = deploymentTarget?.deployment?.docker?.host || deploymentTarget?.host;
          const deploymentType = deploymentTarget?.deployment?.type || deploymentTarget?.type;

          if (deploymentTarget) {
            if (dockerHost?.startsWith('ssh://')) {
              type = 'remote-ssh';
            } else if (deploymentType === 'docker-engine' || deploymentType === 'docker-compose') {
              type = 'local';
            } else if (deploymentType === 'gcp') {
              type = 'gcp';
            }
          }

          // Determine persistence driver early so we can conditionally connect to Firestore
          // New structure: executionContexts.staging.runtime.persistence.driver
          // Old structure: deploymentTargets.staging.persistence.driver
          persistenceConfig = deploymentTarget?.runtime?.persistence || deploymentTarget?.persistence;

          if (persistenceConfig?.driver) {
            persistenceDriver = persistenceConfig.driver as 'postgres' | 'firestore';
          } else {
            // Default: postgres (platform-agnostic default since Sprint 344)
            persistenceDriver = 'postgres';
          }

          if (deploymentTarget) {
            // Extract gateway configuration
            // New structure: executionContexts.staging.runtime.gateway
            // Old structure: deploymentTargets.staging.gateway
            const gatewayConfig = deploymentTarget?.runtime?.gateway || deploymentTarget?.gateway;

            if (gatewayConfig?.url) {
              gateway = {
                url: gatewayConfig.url,
                authToken: gatewayConfig.authToken || this.defaultAuthToken
              };
              this.logger.debug({ target: targetName, gatewayUrl: gateway.url, hasToken: !!gateway.authToken }, 'Resolved gateway URL from architecture.yaml');
            }

            // Extract SSH details for remote targets
            const remoteDir = deploymentTarget?.deployment?.docker?.remoteDir || deploymentTarget?.remoteDir;

            if (type === 'remote-ssh' && dockerHost?.startsWith('ssh://')) {
              const sshTarget = dockerHost.replace('ssh://', '');
              ssh = {
                target: sshTarget,
                remoteDir
              };
              this.logger.debug({ target: targetName, sshTarget: ssh.target, remoteDir: ssh.remoteDir }, 'Resolved SSH connection details');
            }
          }
        } catch (error: any) {
          this.logger.warn({ target: targetName, error: error.message }, 'Failed to load gateway/SSH config from architecture.yaml');
          // Continue without gateway/SSH details - not fatal
        }
      } else {
        // No target name specified - default to postgres
        persistenceDriver = 'postgres';
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
          // New structure: executionContexts.staging.runtime.persistence.connection
          // Old structure: deploymentTargets.staging.persistence
          const pgConnection = persistenceConfig?.connection || persistenceConfig;

          if (pgConnection?.host) {
            const pgHost = pgConnection.host;
            const pgPort = pgConnection.port || 5432;
            const pgDatabase = pgConnection.database || 'bitbrat';
            const pgUsername = pgConnection.username || 'bitbrat';
            const pgPassword = pgConnection.password || '';

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

      // Setup Loki access for remote-ssh targets
      let lokiTunnel: TargetConnection['lokiTunnel'];
      let tunnelCleanup: (() => Promise<void>) | undefined;
      let lokiUrl: string | undefined;

      if (type === 'remote-ssh' && ssh) {
        // Extract hostname from ssh target (e.g., "root@bitbrat.lan" -> "bitbrat.lan")
        const remoteHost = ssh.target.includes('@') ? ssh.target.split('@')[1] : ssh.target;

        // First, try direct connection to Loki (if port is publicly exposed)
        const directLokiUrl = `http://${remoteHost}:3100`;
        this.logger.debug({ directLokiUrl }, 'Checking if Loki is directly accessible');

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          const response = await fetch(`${directLokiUrl}/ready`, {
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            this.logger.info({ lokiUrl: directLokiUrl }, 'Loki is directly accessible (no tunnel needed)');
            lokiUrl = directLokiUrl;
          }
        } catch (error) {
          this.logger.debug({ error: (error as Error).message }, 'Direct Loki access failed, will try SSH tunnel');
        }

        // If direct access failed, create SSH tunnel
        if (!lokiUrl) {
          try {
            this.logger.info({ sshTarget: ssh.target }, 'Creating SSH tunnel for Loki access');

            const tunnel = await this.sshTunnelManager.createTunnel({
              sshTarget: ssh.target,
              remotePort: 3100, // Loki default port
              remoteHost: 'localhost'
            });

            lokiTunnel = {
              localPort: tunnel.localPort,
              remotePort: tunnel.remotePort
            };

            tunnelCleanup = tunnel.close;

            this.logger.info({
              sshTarget: ssh.target,
              localPort: tunnel.localPort,
              remotePort: tunnel.remotePort
            }, 'SSH tunnel for Loki established');
          } catch (error: any) {
            // Log warning but don't fail - Loki is optional
            this.logger.warn({
              sshTarget: ssh.target,
              error: error.message
            }, 'Failed to create SSH tunnel for Loki (will fall back to Docker logs)');
          }
        }
      }

      // Extract GCP project ID for Cloud Run logs (independent of persistence layer)
      // Priority: deployment config > Firestore connection > environment variables
      let gcpProjectId: string | undefined;

      if (deploymentTarget?.gcp?.projectId) {
        // Explicit GCP project ID in deployment target config
        gcpProjectId = deploymentTarget.gcp.projectId;
      } else if (target.projectId) {
        // From Firestore connection (when persistenceDriver === 'firestore')
        gcpProjectId = target.projectId;
      } else if (type === 'gcp' || deploymentTarget?.deployment?.type === 'cloud-run') {
        // For GCP/Cloud Run deployments, try environment variables
        gcpProjectId = process.env.GCLOUD_PROJECT
          || process.env.GOOGLE_CLOUD_PROJECT
          || process.env.FIREBASE_PROJECT_ID;
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
        gcpProjectId,
        gateway,
        ssh,
        loki: lokiUrl || lokiTunnel ? {
          url: lokiUrl,
          tunnel: lokiTunnel
        } : undefined,
        lokiTunnel, // Keep for backward compatibility
        cleanup: async () => {
          // Cleanup PostgreSQL connection pool if exists
          if (store && typeof store.close === 'function') {
            await store.close();
          }
          // Cleanup Firestore connection if exists
          if (cleanupFn) {
            await cleanupFn();
          }
          // Cleanup SSH tunnel if exists
          if (tunnelCleanup) {
            await tunnelCleanup();
          }
        },
      };

      this.logger.info({
        target: connection.name,
        type: connection.type,
        projectId: connection.firestore.projectId,
        gcpProjectId: connection.gcpProjectId,
        persistenceDriver: connection.persistenceDriver,
        hasGateway: !!connection.gateway,
        hasSsh: !!connection.ssh,
        lokiAccess: connection.loki?.url ? 'direct' : connection.loki?.tunnel ? 'tunnel' : 'none',
        lokiUrl: connection.loki?.url
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

    // Also close all SSH tunnels
    await this.sshTunnelManager.closeAll();
  }
}
