/**
 * Business Logic: Fleet Registry Resolution
 * Sprint 360: Extracted from cli/fleet.ts:252-348
 *
 * Resolves the fleet registry based on execution context.
 * Handles Sprint 349+ context integration (postgres vs firestore).
 *
 * Priority:
 * 1. Legacy --target flag (Firestore emulator for backward compatibility)
 * 2. ContextResolver (reads persistence.driver from execution context)
 * 3. Fallback to Firestore
 *
 * Used by:
 * - All 7 fleet commands
 * - FleetCommand base class
 */

import type { Logger } from '../orchestration/logger';
import type { RegistryReader } from '../fleet';
import { ContextResolver } from '../context/context-resolver';
import { getCurrentContext } from '../config/bratrc';
import type { FleetDeps } from './fleet-deps';
import { PostgresDocumentStore } from '../../../../src/common/persistence/postgres-store';
import { PostgresRegistryReader } from '../fleet/postgres-registry';
import type { FirestoreConnectOptions } from '../providers/gcp/firestore';

/**
 * Registry resolution result
 */
export interface RegistryResolutionResult {
  /**
   * Resolved registry reader
   */
  registry: RegistryReader;

  /**
   * Cleanup function (optional, for remote connections)
   */
  cleanup?: () => Promise<void>;

  /**
   * Whether this is a local Docker environment
   */
  isLocalDocker: boolean;

  /**
   * Description of resolved registry (for logging)
   */
  description?: string;
}

/**
 * Registry resolution options
 */
export interface RegistryResolutionOptions {
  /**
   * Repository root directory
   */
  repoRoot: string;

  /**
   * Fleet dependencies (for factory functions)
   */
  deps: FleetDeps;

  /**
   * Logger
   */
  logger: Logger;

  /**
   * Execution context name (from --context flag)
   * Priority: flag > BITBRAT_CONTEXT > ~/.bratrc > 'local'
   */
  contextName?: string;

  /**
   * Legacy --target flag (Firestore-specific)
   * @deprecated Use context-based resolution instead
   */
  legacyTarget?: string;

  /**
   * Legacy --project-id flag
   * @deprecated Use context-based resolution instead
   */
  legacyProjectId?: string;

  /**
   * Legacy --emulator-host flag
   * @deprecated Use context-based resolution instead
   */
  legacyEmulatorHost?: string;

  /**
   * Legacy --database flag
   * @deprecated Use context-based resolution instead
   */
  legacyDatabase?: string;
}

/**
 * Resolve fleet registry based on execution context
 *
 * This is the Sprint 349+ integration that determines registry based on
 * context persistence driver (postgres or firestore).
 *
 * @param options - Resolution options
 * @returns Registry resolution result
 */
export async function resolveRegistry(
  options: RegistryResolutionOptions
): Promise<RegistryResolutionResult> {
  const {
    repoRoot,
    deps,
    logger,
    contextName: contextNameOverride,
    legacyTarget,
    legacyProjectId,
    legacyEmulatorHost,
    legacyDatabase,
  } = options;

  // Legacy path: --target flag maps to Firestore emulator (backward compatibility)
  if (legacyTarget) {
    return await resolveLegacyFirestoreRegistry({
      target: legacyTarget,
      projectId: legacyProjectId,
      emulatorHost: legacyEmulatorHost,
      database: legacyDatabase,
      deps,
      logger,
    });
  }

  // Sprint 349+: Use ContextResolver to determine persistence driver
  let context: any;
  let contextName: string;

  try {
    const resolver = new ContextResolver(repoRoot);
    contextName = contextNameOverride || process.env.BITBRAT_CONTEXT || getCurrentContext() || 'local';
    context = await resolver.resolve(contextName);
  } catch (err: any) {
    logger.warn(
      { action: 'fleet.registry.fallback', error: err.message },
      'Context resolution failed, falling back to Firestore'
    );

    // Fallback to Firestore (backward compatibility)
    return await resolveFirestoreRegistry({
      contextName: 'fallback',
      projectId: legacyProjectId,
      emulatorHost: legacyEmulatorHost,
      database: legacyDatabase,
      isLocalDocker: false,
      deps,
      logger,
    });
  }

  // Context resolved successfully, now resolve registry
  const isLocalDocker =
    context.deployment.type === 'docker-compose' &&
    (context.deployment.docker?.host.startsWith('unix://') || false);

  // Create appropriate registry based on persistence driver
  if (context.runtime.persistence.driver === 'postgres') {
    return await resolvePostgresRegistry({
      contextName,
      context,
      isLocalDocker,
      logger,
    });
  } else if (context.runtime.persistence.driver === 'firestore') {
    return await resolveFirestoreRegistry({
      contextName,
      projectId: legacyProjectId,
      emulatorHost: legacyEmulatorHost,
      database: legacyDatabase,
      isLocalDocker,
      deps,
      logger,
    });
  } else {
    throw new Error(
      `Unknown persistence driver for context '${contextName}': ${context.runtime.persistence.driver}`
    );
  }
}

/**
 * Resolve PostgreSQL registry
 */
async function resolvePostgresRegistry(options: {
  contextName: string;
  context: any;
  isLocalDocker: boolean;
  logger: Logger;
}): Promise<RegistryResolutionResult> {
  const { contextName, context, isLocalDocker, logger } = options;

  const conn = context.runtime.persistence.connection;
  if (!conn) {
    throw new Error(`PostgreSQL connection not configured for context '${contextName}'`);
  }

  // Build connection string
  const connectionString = `postgresql://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${conn.database}`;

  // Create PostgreSQL document store
  const store = new PostgresDocumentStore({ connectionString });
  store.setLogger(logger);

  // Create PostgreSQL registry reader
  const registry = new PostgresRegistryReader(store, logger);

  logger.info(
    {
      action: 'fleet.registry.resolved',
      context: contextName,
      driver: 'postgres',
      host: conn.host,
    },
    `Fleet registry resolved to PostgreSQL (${conn.host}:${conn.port}/${conn.database})`
  );

  return {
    registry,
    isLocalDocker,
    description: `PostgreSQL (${conn.host}:${conn.port}/${conn.database})`,
  };
}

/**
 * Resolve Firestore registry (Sprint 349+ context-based)
 */
async function resolveFirestoreRegistry(options: {
  contextName: string;
  projectId?: string;
  emulatorHost?: string;
  database?: string;
  isLocalDocker: boolean;
  deps: FleetDeps;
  logger: Logger;
}): Promise<RegistryResolutionResult> {
  const { contextName, projectId, emulatorHost, database, isLocalDocker, deps, logger } = options;

  const connectOptions: FirestoreConnectOptions = {
    projectId,
    emulatorHost,
    databaseId: database,
  };

  if (!deps.registryFactory) {
    throw new Error('FleetDeps.registryFactory not provided');
  }

  const registry = deps.registryFactory(connectOptions, logger);

  logger.info(
    { action: 'fleet.registry.resolved', context: contextName, driver: 'firestore' },
    `Fleet registry resolved to Firestore`
  );

  return {
    registry,
    isLocalDocker,
    description: 'Firestore',
  };
}

/**
 * Resolve legacy Firestore registry (--target flag)
 * @deprecated Use context-based resolution instead
 */
async function resolveLegacyFirestoreRegistry(options: {
  target: string;
  projectId?: string;
  emulatorHost?: string;
  database?: string;
  deps: FleetDeps;
  logger: Logger;
}): Promise<RegistryResolutionResult> {
  const { target, projectId, emulatorHost, database, deps, logger } = options;

  const m: Record<string, string> = { target };
  if (projectId) m['project-id'] = projectId;
  if (emulatorHost) m['emulator-host'] = emulatorHost;
  if (database) m['database'] = database;

  if (!deps.connectionResolverFn || !deps.registryFactory) {
    throw new Error('FleetDeps.connectionResolverFn and registryFactory required for legacy target');
  }

  const resolved = await deps.connectionResolverFn({ projectId }, m, logger);
  const registry = deps.registryFactory(resolved.connectOptions, logger);
  const isLocalDocker = resolved.targetKind === 'local';

  logger.info(
    {
      action: 'fleet.target.resolved',
      target,
      isEmulator: resolved.isEmulator,
      kind: resolved.targetKind,
    },
    `Fleet registry resolved to ${resolved.description}`
  );

  return {
    registry,
    cleanup: resolved.cleanup,
    isLocalDocker,
    description: resolved.description,
  };
}
