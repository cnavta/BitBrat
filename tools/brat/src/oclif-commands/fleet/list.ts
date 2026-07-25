/**
 * Fleet List Command
 *
 * Lists all live Bits in the fleet with their profile and exposure metadata.
 * This is the flagship example demonstrating:
 * - Fleet management with MCP client integration
 * - Dependency injection pattern for testability
 * - Multiple output formats (table, json, yaml)
 * - Pattern for all other fleet subcommands
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import * as yaml from 'js-yaml';
import {
  FleetClient,
  FleetIdentity,
  FleetTransport,
  RegistryReader,
  GatewayTransport,
  resolveIdentity,
  resolveServiceHostPort,
} from '../../fleet';
import { PostgresRegistryReader } from '../../fleet/postgres-registry';
import { PostgresDocumentStore } from '../../../../../src/common/persistence/postgres-store';
import { FirestoreRegistryReader } from '../../fleet/firestore-registry';
import { resolveBackupConnection } from '../../backup/connection';
import { ConfigurationError } from '../../orchestration/errors';
import type { Logger } from '../../orchestration/logger';

/** The tool-gateway's internal container port */
const GATEWAY_CONTAINER_PORT = 3000;

/**
 * Injectable dependencies for fleet list command
 * Enables unit testing without real network / Firestore
 */
export interface FleetListDeps {
  resolveIdentityFn?: (opts: { roles?: string[]; userId?: string }, logger?: Logger) => FleetIdentity;
  gatewayTransportFactory?: (baseUrl: string, identity: FleetIdentity, logger?: Logger) => FleetTransport;
  registryFactory?: (context: any, logger?: Logger) => Promise<RegistryReader>;
  hostPortResolverFn?: (service: string, containerPort: number, logger?: Logger) => number;
}

export default class FleetList extends BratCommand {
  static description = 'List all live Bits in the fleet';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --format yaml',
    '<%= config.bin %> <%= command.id %> --context staging',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'json', 'yaml'],
      default: 'table',
    }),
  };

  /**
   * Dependency injection container for testing
   */
  private fleetDeps?: FleetListDeps;

  async run(): Promise<void> {
    const { flags } = await this.parse(FleetList);

    this.logger.debug({ context: this.context.name, format: flags.format }, 'Listing fleet');

    try {
      // Resolve identity with bit:read scope
      const identity = this.resolveIdentity(['bit:read']);

      // Create registry based on persistence driver
      const registry = await this.createRegistry();

      // Resolve gateway URL and create transport
      const baseUrl = await this.resolveGatewayUrl();
      const transport = this.createGatewayTransport(baseUrl, identity);

      // Create fleet client
      const client = new FleetClient({
        transport,
        identity,
        registry,
        logger: this.logger,
      });

      try {
        // List all bits
        const bits = await client.list();

        this.logger.debug({ count: bits.length }, 'Retrieved fleet list');

        // Output in requested format
        this.outputBits(bits, flags.format);
      } finally {
        await client.close();
      }
    } catch (error: any) {
      this.logger.error({ error: error.message, stack: error.stack }, 'Fleet list failed');
      this.error(error.message || 'Fleet list failed', { exit: 1 });
    }
  }

  /**
   * Get or create dependency injection container
   * Allows tests to inject mock dependencies
   */
  protected getFleetDeps(overrides?: Partial<FleetListDeps>): FleetListDeps {
    if (overrides) {
      this.fleetDeps = { ...this.fleetDeps, ...overrides };
    }

    if (!this.fleetDeps) {
      this.fleetDeps = {
        resolveIdentityFn: (opts, logger) => resolveIdentity(opts, logger),
        gatewayTransportFactory: (baseUrl, _identity, logger) => new GatewayTransport({ baseUrl, logger }),
        hostPortResolverFn: (service, containerPort, logger) =>
          resolveServiceHostPort(service, { containerPort, logger }),
      };
    }

    return this.fleetDeps;
  }

  /**
   * Resolve fleet identity from environment
   * Throws PermissionError (fail-closed) if no MCP_AUTH_TOKEN
   */
  private resolveIdentity(roles: string[]): FleetIdentity {
    const deps = this.getFleetDeps();
    const resolveIdentityFn = deps.resolveIdentityFn || ((opts, logger) => resolveIdentity(opts, logger));

    const identity = resolveIdentityFn(
      {
        roles,
        userId: process.env.MCP_USER_ID,
      },
      this.logger,
    );

    this.logger.debug({ userId: identity.userId, roles }, 'Identity resolved');

    return identity;
  }

  /**
   * Create registry reader based on persistence driver
   */
  private async createRegistry(): Promise<RegistryReader> {
    const deps = this.getFleetDeps();

    if (deps.registryFactory) {
      return deps.registryFactory(this.context, this.logger);
    }

    // Create registry based on persistence driver
    if (this.context.runtime.persistence.driver === 'postgres') {
      const conn = this.context.runtime.persistence.connection;
      if (!conn) {
        throw new ConfigurationError(
          `PostgreSQL connection not configured for context '${this.context.name}'`,
        );
      }

      // Build connection string
      const connectionString = `postgresql://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${conn.database}`;

      // Create PostgreSQL document store
      const store = new PostgresDocumentStore({ connectionString });
      store.setLogger(this.logger);

      // Create PostgreSQL registry
      const registry = new PostgresRegistryReader(store, this.logger);

      this.logger.debug({ driver: 'postgres', host: conn.host, database: conn.database }, 'Registry created');

      return registry;
    } else if (this.context.runtime.persistence.driver === 'firestore') {
      // Legacy Firestore path
      const projectId = process.env.GOOGLE_CLOUD_PROJECT;
      if (!projectId) {
        throw new ConfigurationError(
          `Firestore project ID not configured. Set GOOGLE_CLOUD_PROJECT environment variable.`,
        );
      }

      const connectOptions = {
        projectId,
        emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      };

      const registry = new FirestoreRegistryReader(connectOptions, this.logger);

      this.logger.debug({ driver: 'firestore', projectId, emulatorHost: connectOptions.emulatorHost }, 'Registry created');

      return registry;
    } else {
      throw new ConfigurationError(
        `Unknown persistence driver: ${this.context.runtime.persistence.driver}`,
      );
    }
  }

  /**
   * Resolve gateway URL based on execution context
   */
  private async resolveGatewayUrl(): Promise<string> {
    const deps = this.getFleetDeps();

    // Check for explicit TOOL_GATEWAY_URL override
    if (process.env.TOOL_GATEWAY_URL) {
      this.logger.debug({ url: process.env.TOOL_GATEWAY_URL }, 'Using explicit gateway URL');
      return process.env.TOOL_GATEWAY_URL;
    }

    // For local Docker, resolve published host port
    const isLocalDocker =
      this.context.deployment.type === 'docker-compose' &&
      (this.context.deployment.docker?.host.startsWith('unix://') || false);

    if (isLocalDocker) {
      const hostPortResolverFn =
        deps.hostPortResolverFn || ((service, containerPort, logger) =>
          resolveServiceHostPort(service, { containerPort, logger }));

      const port = hostPortResolverFn('tool-gateway', GATEWAY_CONTAINER_PORT, this.logger);
      const url = `http://localhost:${port}`;

      this.logger.debug({ url, port, service: 'tool-gateway' }, 'Resolved local gateway URL');

      return url;
    }

    // For cloud deployments, use gateway configuration from context
    if (this.context.runtime.gateway?.url) {
      this.logger.debug({ url: this.context.runtime.gateway.url }, 'Using context gateway URL');
      return this.context.runtime.gateway.url;
    }

    throw new ConfigurationError(
      `Gateway URL not configured for context '${this.context.name}'. Set TOOL_GATEWAY_URL or configure runtime.gateway.url in architecture.yaml`,
    );
  }

  /**
   * Create gateway transport
   */
  private createGatewayTransport(baseUrl: string, identity: FleetIdentity): FleetTransport {
    const deps = this.getFleetDeps();
    const gatewayTransportFactory =
      deps.gatewayTransportFactory || ((url, _identity, logger) => new GatewayTransport({ baseUrl: url, logger }));

    return gatewayTransportFactory(baseUrl, identity, this.logger);
  }

  /**
   * Output bits in requested format
   */
  private outputBits(bits: Array<{ name: string; profile?: string; exposure?: string }>, format: string): void {
    if (format === 'json') {
      this.log(JSON.stringify(bits, null, 2));
    } else if (format === 'yaml') {
      this.log(yaml.dump(bits));
    } else {
      // Table format (default)
      this.log('BIT                 PROFILE      EXPOSURE');
      for (const bit of bits) {
        const name = bit.name.padEnd(20);
        const profile = (bit.profile || '-').padEnd(13);
        const exposure = bit.exposure || '-';
        this.log(`${name}${profile}${exposure}`);
      }
    }
  }
}
