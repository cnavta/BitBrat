/**
 * Context Adapter
 *
 * Converts ResolvedContext (from ContextResolver) to TargetConnection (used by Dev MCP tools).
 * This adapter bridges the platform-standard execution context framework with Dev MCP's
 * tool-specific connection requirements.
 */

import type { ResolvedContext, ResolvedPersistence } from '../../context/types';
import type { TargetConnection } from '../types';
import { Logger } from '../../orchestration/logger';
import { SSHTunnelManager } from '../ssh-tunnel';

/**
 * ContextAdapter
 *
 * Bridges the gap between platform-standard ResolvedContext and Dev MCP's TargetConnection.
 * Responsibilities:
 * - Convert ResolvedContext → TargetConnection
 * - Initialize persistence backends (PostgreSQL or Firestore)
 * - Set up SSH tunnels when needed
 * - Provide cleanup handlers
 */
export class ContextAdapter {
  private sshTunnelManager: SSHTunnelManager;

  constructor(private logger: Logger) {
    this.sshTunnelManager = new SSHTunnelManager(logger);
  }

  /**
   * Create a TargetConnection from a ResolvedContext
   *
   * @param resolved - Fully resolved execution context
   * @returns Target connection ready for Dev MCP tools
   */
  async createConnection(resolved: ResolvedContext): Promise<TargetConnection> {
    this.logger.debug({ context: resolved.name }, 'Creating connection from resolved context');

    // Map deployment type (with SSH detection)
    const type = this.mapDeploymentType(resolved.deployment.type, resolved);

    // Extract SSH details (for remote Docker deployments)
    const ssh = this.extractSSHDetails(resolved);

    // Extract Loki configuration (Dev MCP specific)
    const loki = this.extractLokiConfig(resolved);

    // Create base connection
    const connection: TargetConnection = {
      name: resolved.name,
      type,
      persistenceDriver: resolved.runtime.persistence.driver,
      gateway: {
        url: resolved.runtime.gateway.url,
        authToken: resolved.runtime.gateway.authToken,
      },
      ssh,
      loki,
      firestore: {
        db: null as any, // Placeholder, will be set below if needed
        projectId: '',
        databaseId: undefined,
      },
      cleanup: async () => {
        await this.cleanup(connection);
      },
    };

    // Initialize persistence backend
    await this.initializePersistence(connection, resolved.runtime.persistence);

    // Set up SSH tunnel if needed for Loki
    if (loki?.tunnel && ssh) {
      await this.setupSSHTunnel(connection, ssh.target, loki.tunnel.localPort, loki.tunnel.remotePort);
    }

    this.logger.info({ context: resolved.name, type, driver: connection.persistenceDriver }, 'Connection created');

    return connection;
  }

  /**
   * Map deployment type to TargetConnection type
   */
  private mapDeploymentType(type: string, resolved: ResolvedContext): TargetConnection['type'] {
    // Check if Docker host is SSH-based (remote-ssh)
    const dockerHost = resolved.deployment.docker?.host;
    if (dockerHost?.startsWith('ssh://')) {
      this.logger.debug({ dockerHost, type: 'remote-ssh' }, 'Detected SSH-based Docker host');
      return 'remote-ssh';
    }

    switch (type) {
      case 'docker-compose':
      case 'docker-engine':
        this.logger.debug({ type: 'local' }, 'Using local Docker deployment');
        return 'local';
      case 'cloud-run':
      case 'gcp':
        this.logger.debug({ type: 'gcp' }, 'Using GCP Cloud Run deployment');
        return 'gcp';
      default:
        this.logger.warn({ type }, 'Unknown deployment type, defaulting to local');
        return 'local';
    }
  }

  /**
   * Extract SSH connection details from resolved context
   */
  private extractSSHDetails(resolved: ResolvedContext): TargetConnection['ssh'] | undefined {
    const dockerHost = resolved.deployment.docker?.host;
    const remoteDir = resolved.deployment.docker?.remoteDir;

    if (!dockerHost) {
      return undefined;
    }

    // Check if this is an SSH connection
    if (dockerHost.startsWith('ssh://')) {
      const sshTarget = dockerHost.replace('ssh://', '');
      return {
        target: sshTarget,
        remoteDir,
      };
    }

    return undefined;
  }

  /**
   * Extract Loki configuration from resolved context
   *
   * Note: Loki config is not currently part of ResolvedContext,
   * so we extract it from environment variables or deployment config if available.
   * This is a placeholder for future Loki integration in ContextResolver.
   */
  private extractLokiConfig(resolved: ResolvedContext): TargetConnection['loki'] | undefined {
    const envVars = resolved.runtime.envVars;

    // Check for Loki URL in env vars
    const lokiUrl = envVars.LOKI_URL;
    if (lokiUrl) {
      return { url: lokiUrl };
    }

    // Check for tunnel configuration
    const lokiTunnelLocal = envVars.LOKI_TUNNEL_LOCAL_PORT;
    const lokiTunnelRemote = envVars.LOKI_TUNNEL_REMOTE_PORT;

    if (lokiTunnelLocal && lokiTunnelRemote) {
      return {
        tunnel: {
          localPort: parseInt(lokiTunnelLocal, 10),
          remotePort: parseInt(lokiTunnelRemote, 10),
        },
      };
    }

    // Default Loki for remote SSH deployments
    if (resolved.deployment.docker?.host?.startsWith('ssh://')) {
      return {
        tunnel: {
          localPort: 3100,
          remotePort: 3100,
        },
      };
    }

    return undefined;
  }

  /**
   * Initialize persistence backend based on driver
   */
  private async initializePersistence(
    connection: TargetConnection,
    persistence: ResolvedPersistence
  ): Promise<void> {
    if (persistence.driver === 'postgres') {
      await this.createPostgresStore(connection, persistence);
    } else if (persistence.driver === 'firestore') {
      await this.createFirestoreConnection(connection, persistence);
    }
  }

  /**
   * Create PostgreSQL DocumentStore
   */
  private async createPostgresStore(
    connection: TargetConnection,
    persistence: ResolvedPersistence
  ): Promise<void> {
    if (!persistence.connection) {
      throw new Error(`PostgreSQL connection config missing for context '${connection.name}'`);
    }

    const { host, port, database, username, password } = persistence.connection;
    const connectionString = `postgresql://${username}:${password}@${host}:${port}/${database}`;

    this.logger.debug({ context: connection.name, host, port, database }, 'Creating PostgreSQL store');

    try {
      // Dynamically import PostgresDocumentStore
      // Path: tools/brat/src/dev-mcp/adapters → repo root → src/common/persistence
      const postgresStoreModule = require('../../../../../src/common/persistence/postgres-store');
      const { PostgresDocumentStore } = postgresStoreModule;

      const store = new PostgresDocumentStore({
        connectionString,
        poolSize: 5, // Smaller pool for dev-mcp tools
        ssl: false
      });

      // Set logger
      store.setLogger(this.logger);

      connection.store = store;

      this.logger.info({ context: connection.name }, 'PostgreSQL store initialized');
    } catch (error: any) {
      throw new Error(
        `Failed to create PostgreSQL store for context '${connection.name}': ${error.message}`
      );
    }
  }

  /**
   * Create Firestore connection
   */
  private async createFirestoreConnection(
    connection: TargetConnection,
    persistence: ResolvedPersistence
  ): Promise<void> {
    // For Firestore, we need GCP project ID from deployment config
    // This is a limitation of the current ResolvedPersistence type
    // which doesn't include Firestore-specific config

    this.logger.warn({ context: connection.name }, 'Firestore persistence requested but not fully supported in ContextAdapter yet');

    // Placeholder: We would need to get this from somewhere
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const databaseId = process.env.FIRESTORE_DATABASE_ID;

    if (!projectId) {
      throw new Error(
        `Firestore driver requires GCLOUD_PROJECT or GCP_PROJECT environment variable for context '${connection.name}'`
      );
    }

    try {
      // Dynamically import Firestore helper
      // Path: tools/brat/src/dev-mcp/adapters → dev-mcp → src → brat → providers/gcp/firestore
      const firestoreModule = require('../../../providers/gcp/firestore');
      const { getBackupFirestore } = firestoreModule;

      const result = getBackupFirestore({ projectId, databaseId }, this.logger);

      connection.firestore = {
        db: result.db,
        projectId: result.target.projectId,
        databaseId: result.target.databaseId,
      };

      this.logger.info({ context: connection.name, projectId, databaseId }, 'Firestore connection initialized');
    } catch (error: any) {
      throw new Error(
        `Failed to create Firestore connection for context '${connection.name}': ${error.message}`
      );
    }
  }

  /**
   * Set up SSH tunnel
   */
  private async setupSSHTunnel(
    connection: TargetConnection,
    sshTarget: string,
    localPort: number,
    remotePort: number
  ): Promise<void> {
    this.logger.debug({ context: connection.name, sshTarget, localPort, remotePort }, 'Setting up SSH tunnel');

    try {
      const tunnel = await this.sshTunnelManager.createTunnel({
        sshTarget,
        localPort,
        remotePort,
        remoteHost: 'localhost'
      });

      connection.lokiTunnel = {
        localPort: tunnel.localPort,
        remotePort: tunnel.remotePort
      };

      this.logger.info({ context: connection.name, localPort: tunnel.localPort, remotePort: tunnel.remotePort }, 'SSH tunnel established');
    } catch (error: any) {
      this.logger.warn({ context: connection.name, error: error.message }, 'Failed to set up SSH tunnel');
      // Don't throw - SSH tunnel is optional
    }
  }

  /**
   * Cleanup connection resources
   */
  private async cleanup(connection: TargetConnection): Promise<void> {
    this.logger.debug({ context: connection.name }, 'Cleaning up connection');

    // Close PostgreSQL store
    if (connection.store) {
      try {
        await connection.store.close();
        this.logger.debug({ context: connection.name }, 'PostgreSQL store closed');
      } catch (error: any) {
        this.logger.warn({ context: connection.name, error: error.message }, 'Failed to close PostgreSQL store');
      }
    }

    // Close SSH tunnel - The tunnel's close() function handles cleanup
    // No need to call sshTunnelManager directly since the tunnel stores its own cleanup handler

    this.logger.info({ context: connection.name }, 'Connection cleanup complete');
  }
}
