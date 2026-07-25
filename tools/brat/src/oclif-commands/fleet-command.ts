/**
 * FleetCommand Base Class
 * Sprint 360: Base class for all fleet commands
 *
 * Orchestrates business logic modules:
 * - registry-resolver: PostgreSQL/Firestore registry resolution
 * - gateway-resolver: Gateway URL resolution
 * - fleet-deps: Dependency injection
 * - fleet-helpers: RBAC-aware operations
 * - fleet-dispatcher: Command routing
 *
 * Provides common infrastructure:
 * - Context resolution
 * - Registry resolution (Sprint 349+ context integration)
 * - Transport creation (gateway or direct)
 * - FleetClient creation
 * - Identity resolution (RBAC)
 *
 * Used by:
 * - All 7 fleet commands (list, info, health, config, flags, log, drain, shutdown)
 */

import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import { FleetClient } from '../fleet';
import type { FleetTransport, RegistryReader } from '../fleet';
import { rewriteToLocalHostPort } from '../fleet';
import { resolveRegistry } from '../business/registry-resolver';
import { resolveGatewayUrl } from '../business/gateway-resolver';
import { createDefaultFleetDeps, mergeFleetDeps } from '../business/fleet-deps';
import type { FleetDeps } from '../business/fleet-deps';
import { dispatchFleetCommand } from '../business/fleet-dispatcher';
import type { FleetDispatchOptions } from '../business/fleet-dispatcher';
import { ConfigurationError } from '../orchestration/errors';

/**
 * Default gateway container port
 */
const GATEWAY_CONTAINER_PORT = 3000;

/**
 * Read-only fleet subcommands (bit:read scope)
 */
const READ_SUBS = new Set(['list', 'info', 'health', 'config', 'flags']);

/**
 * Mutating fleet subcommands (bit:operate scope)
 */
const MUTATING_SUBS = new Set(['log', 'drain', 'shutdown', 'restart']);

/**
 * Base class for all fleet commands
 *
 * Handles common fleet infrastructure:
 * - Registry resolution (postgres vs firestore)
 * - Gateway URL resolution
 * - Identity resolution (RBAC)
 * - Transport creation (fabric or break-glass)
 * - FleetClient lifecycle
 */
export abstract class FleetCommand extends BratCommand {
  /**
   * Common fleet flags
   */
  static baseFlags = {
    ...BratCommand.baseFlags,

    // Targeting flags
    all: Flags.boolean({
      description: 'Target all Bits (fan-out for read ops, sequential with --confirm for mutations)',
      default: false,
    }),
    direct: Flags.string({
      description: 'Break-glass: bypass gateway, target single Bit directly (logged as fleet.break_glass)',
    }),

    // Output flags
    json: Flags.boolean({
      description: 'Output JSON instead of human-readable format',
      default: false,
    }),

    // Safety flags
    confirm: Flags.boolean({
      description: 'Confirm high-blast-radius operations (required for --all mutations)',
      default: false,
    }),

    // RBAC flags
    roles: Flags.string({
      description: 'MCP roles (comma-separated, e.g., bit:read,bit:operate)',
      multiple: true,
    }),
    'user-id': Flags.string({
      description: 'User ID for audit trail',
    }),

    // Gateway override
    url: Flags.string({
      description: 'Override gateway base URL (default: resolved from context)',
    }),

    // Legacy compatibility flags (deprecated)
    target: Flags.string({
      description: '[DEPRECATED] Use --context instead. Firestore emulator target.',
      hidden: true,
    }),
    'project-id': Flags.string({
      description: '[DEPRECATED] GCP project ID (use context configuration)',
      hidden: true,
    }),
    'emulator-host': Flags.string({
      description: '[DEPRECATED] Firestore emulator host (use context configuration)',
      hidden: true,
    }),
    database: Flags.string({
      description: '[DEPRECATED] Firestore database ID (use context configuration)',
      hidden: true,
    }),
  };

  /**
   * Fleet dependencies (for testing)
   */
  protected fleetDeps: FleetDeps = createDefaultFleetDeps();

  /**
   * Subcommand name (implemented by subclass)
   */
  protected abstract get subcommand(): string;

  /**
   * Execute fleet command
   *
   * Template method that:
   * 1. Resolves registry (postgres vs firestore)
   * 2. Resolves gateway URL (or creates direct transport)
   * 3. Creates FleetClient
   * 4. Dispatches to appropriate handler
   * 5. Cleans up resources
   */
  async run(): Promise<any> {
    const { flags, args } = await this.parse(this.constructor as any);

    // Validate --direct and --all combination (OQ4)
    if (flags.direct && flags.all) {
      throw new ConfigurationError(
        '--direct cannot be combined with --all (break-glass targets a single Bit).'
      );
    }

    // Determine required roles based on command type
    const isMutating =
      MUTATING_SUBS.has(this.subcommand) ||
      (this.subcommand === 'flags' && args.verb === 'set');
    const defaultRoles = isMutating ? ['bit:operate'] : ['bit:read'];
    const roles = flags.roles && flags.roles.length > 0 ? flags.roles : defaultRoles;

    // Resolve identity (throws PermissionError if no token - fail-closed)
    const identity = this.fleetDeps.resolveIdentityFn!(
      { roles, userId: flags['user-id'] },
      this.logger
    );

    // Resolve registry based on execution context (Sprint 349+)
    const { registry, cleanup: connectionCleanup, isLocalDocker } = await resolveRegistry({
      repoRoot: this.repoRoot,
      deps: this.fleetDeps,
      logger: this.logger,
      contextName: flags.context,
      legacyTarget: flags.target,
      legacyProjectId: flags['project-id'],
      legacyEmulatorHost: flags['emulator-host'],
      legacyDatabase: flags.database,
    });

    // Create transport (fabric by default, direct break-glass behind --direct)
    let transport: FleetTransport;
    if (flags.direct) {
      this.logger.warn(
        {
          action: 'fleet.break_glass',
          bit: flags.direct,
          by: identity.userId || identity.agentName,
          sub: this.subcommand,
        },
        `BREAK-GLASS: bypassing the gateway to reach Bit '${flags.direct}' directly (operator '${
          identity.userId || identity.agentName
        }').`
      );

      // For local docker target, remap the Bit's internal registry URL to its published host port
      const urlRewriter = isLocalDocker
        ? (url: string, bit: string) =>
            rewriteToLocalHostPort(url, bit, {
              logger: this.logger,
              resolveHostPort: (service, containerPort) =>
                this.fleetDeps.hostPortResolverFn!(
                  service,
                  containerPort ?? GATEWAY_CONTAINER_PORT,
                  this.logger
                ),
            })
        : undefined;

      transport = this.fleetDeps.directTransportFactory!(
        flags.direct,
        registry,
        this.logger,
        urlRewriter
      );
    } else {
      const baseUrl = await resolveGatewayUrl({
        repoRoot: this.repoRoot,
        logger: this.logger,
        explicitUrl: flags.url,
        contextName: flags.context,
        isLocalDocker,
        hostPortResolverFn: isLocalDocker ? this.fleetDeps.hostPortResolverFn : undefined,
        legacyEmulatorHost: flags['emulator-host'],
      });

      transport = this.fleetDeps.gatewayTransportFactory!(baseUrl, identity, this.logger);
    }

    // Create FleetClient
    const client = new FleetClient({
      transport,
      identity,
      registry,
      logger: this.logger,
      concurrency: 10, // Default concurrency for --all operations
    });

    try {
      // Dispatch to appropriate handler
      return await dispatchFleetCommand(
        {
          subcommand: this.subcommand,
          bit: args.bit,
          all: flags.all,
          json: flags.json,
          confirm: flags.confirm,
          describe: (flags as any).describe,
          key: (flags as any).key,
          value: (flags as any).value,
          level: (flags as any).level,
          positionals: Object.values(args).filter((v) => typeof v === 'string') as string[],
        } as FleetDispatchOptions,
        client,
        (line: string) => this.log(line),
        this.logger
      );
    } finally {
      // Cleanup
      await client.close();
      if (connectionCleanup) {
        try {
          await connectionCleanup();
        } catch {
          // Best-effort cleanup of any tunnel opened for remote target
        }
      }
    }
  }

  /**
   * Inject fleet dependencies (for testing)
   */
  public injectDeps(deps: Partial<FleetDeps>): void {
    this.fleetDeps = mergeFleetDeps(deps);
  }
}
