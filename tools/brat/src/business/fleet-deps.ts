/**
 * Business Logic: Fleet Command Dependencies
 * Sprint 360: Extracted from cli/fleet.ts
 *
 * Provides dependency injection interfaces for fleet commands.
 * Enables testing without real network, Firestore, or Docker.
 *
 * Used by:
 * - All 7 fleet commands (list, info, health, config, flags, log, drain, shutdown)
 * - FleetCommand base class
 */

import type { Logger } from '../orchestration/logger';
import type {
  FleetIdentity,
  FleetTransport,
  RegistryReader,
  GatewayTransport,
  DirectTransport,
  resolveIdentity,
  resolveServiceHostPort,
} from '../fleet';
import type { ResolvedBackupConnection } from '../backup/connection';
import type { FirestoreConnectOptions } from '../providers/gcp/firestore';

/**
 * Fleet command dependencies interface
 *
 * All dependencies are optional and can be injected for testing.
 * Production code uses default implementations.
 */
export interface FleetDeps {
  /**
   * Resolve MCP identity from roles and userId
   * @default resolveIdentity from ../fleet
   */
  resolveIdentityFn?: (
    opts: { roles?: string[]; userId?: string },
    logger?: Logger
  ) => FleetIdentity;

  /**
   * Create gateway transport (fabric path)
   * @default new GatewayTransport({ baseUrl, logger })
   */
  gatewayTransportFactory?: (
    baseUrl: string,
    identity: FleetIdentity,
    logger?: Logger
  ) => FleetTransport;

  /**
   * Create direct transport (break-glass path)
   * @default new DirectTransport({ bit, registry, logger, urlRewriter })
   */
  directTransportFactory?: (
    bit: string,
    registry: RegistryReader,
    logger?: Logger,
    urlRewriter?: (url: string, bit: string) => string
  ) => FleetTransport;

  /**
   * Resolve Docker service host port (for local stacks)
   * @default resolveServiceHostPort from ../fleet
   */
  hostPortResolverFn?: (
    service: string,
    containerPort: number,
    logger?: Logger
  ) => number;

  /**
   * Create registry reader from Firestore connection
   * @default new FirestoreRegistryReader(connect, logger)
   */
  registryFactory?: (
    connect: FirestoreConnectOptions,
    logger?: Logger
  ) => RegistryReader;

  /**
   * Resolve backup connection (Firestore emulator for local stacks)
   * @default resolveBackupConnection from ../backup/connection
   */
  connectionResolverFn?: (
    flags: { projectId?: string; env?: string },
    m: Record<string, string>,
    logger?: Logger
  ) => Promise<ResolvedBackupConnection>;

  /**
   * Output sink (for capturing command output in tests)
   * @default console.log
   */
  out?: (line: string) => void;
}

/**
 * Create default fleet dependencies
 *
 * Uses production implementations for all dependencies.
 * Import the actual implementations lazily to avoid circular dependencies.
 *
 * @returns Default fleet dependencies
 */
export function createDefaultFleetDeps(): Required<Omit<FleetDeps, 'out'>> & { out: (l: string) => void } {
  // Lazy imports to avoid circular dependencies
  const {
    resolveIdentity: resolveIdentityImpl,
    GatewayTransport: GatewayTransportImpl,
    DirectTransport: DirectTransportImpl,
    resolveServiceHostPort: resolveServiceHostPortImpl,
    FirestoreRegistryReader,
  } = require('../fleet');

  const { resolveBackupConnection: resolveBackupConnectionImpl } = require('../backup/connection');

  return {
    resolveIdentityFn: (opts, logger) => resolveIdentityImpl(opts, logger),
    gatewayTransportFactory: (baseUrl, _identity, logger) =>
      new GatewayTransportImpl({ baseUrl, logger }),
    directTransportFactory: (bit, registry, logger, urlRewriter) =>
      new DirectTransportImpl({ bit, registry, logger, urlRewriter }),
    hostPortResolverFn: (service, containerPort, logger) =>
      resolveServiceHostPortImpl(service, { containerPort, logger }),
    registryFactory: (connect, logger) => new FirestoreRegistryReader(connect, logger),
    connectionResolverFn: (flags, m, logger) => resolveBackupConnectionImpl(flags, m, logger),
    out: (line: string) => console.log(line),
  };
}

/**
 * Merge default dependencies with overrides
 *
 * Utility function for combining default deps with test overrides.
 *
 * @param overrides - Partial dependency overrides
 * @returns Merged dependencies
 */
export function mergeFleetDeps(overrides?: Partial<FleetDeps>): FleetDeps {
  if (!overrides || Object.keys(overrides).length === 0) {
    return createDefaultFleetDeps();
  }

  return {
    ...createDefaultFleetDeps(),
    ...overrides,
  };
}
