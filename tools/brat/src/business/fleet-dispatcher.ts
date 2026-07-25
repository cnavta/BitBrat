/**
 * Business Logic: Fleet Command Dispatcher
 * Sprint 360: Extracted from cli/fleet.ts:422-472
 *
 * Routing logic for all 7 fleet subcommands.
 * Handles command dispatch to appropriate handlers.
 *
 * Subcommands:
 * - list: List all Bits in fleet
 * - info: Get bit.info (single or --all)
 * - health: Get bit.health (single or --all)
 * - config: Get bit.config.get or bit.config.describe
 * - flags: Get/set feature flags
 * - log: Set runtime log level
 * - drain: Gracefully drain Bit
 * - shutdown: Shutdown Bit
 * - restart: Restart Bit (not implemented in original)
 *
 * Used by:
 * - All 7 fleet commands
 * - FleetCommand base class
 */

import type { Logger } from '../orchestration/logger';
import type { FleetClient } from '../fleet';
import { ConfigurationError } from '../orchestration/errors';
import { requireBit, emit, readOrAll, mutate } from './fleet-helpers';
import type { FleetCommandArgs } from './fleet-helpers';

/**
 * Fleet dispatch options
 */
export interface FleetDispatchOptions extends FleetCommandArgs {
  /**
   * Subcommand (list, info, health, config, flags, log, drain, shutdown, restart)
   */
  subcommand: string;

  /**
   * --describe flag (for config command)
   */
  describe?: boolean;

  /**
   * --key flag (for flags command)
   */
  key?: string;

  /**
   * --value flag (for flags command)
   */
  value?: string;

  /**
   * --level flag (for log command)
   */
  level?: string;
}

/**
 * Dispatch fleet command to appropriate handler
 *
 * Routes to one of 9 subcommand handlers:
 * - list: Custom handler with tabular output
 * - info/health: readOrAll (single Bit or --all fan-out)
 * - config: Single Bit with --describe flag support
 * - flags: Single Bit with get/set verb support
 * - log: Single Bit with required --level
 * - drain/shutdown/restart: mutate (single Bit or --all with --confirm)
 *
 * @param options - Dispatch options
 * @param client - Fleet client
 * @param out - Output function
 * @param logger - Logger
 * @returns Command result
 * @throws {ConfigurationError} For unknown subcommand or invalid arguments
 */
export async function dispatchFleetCommand(
  options: FleetDispatchOptions,
  client: FleetClient,
  out: (line: string) => void,
  logger: Logger
): Promise<any> {
  const { subcommand } = options;

  switch (subcommand) {
    case 'list':
      return await handleList(options, client, out);
    case 'info':
      return await readOrAll(options, client, 'bit.info', out);
    case 'health':
      return await readOrAll(options, client, 'bit.health', out);
    case 'config':
      return await handleConfig(options, client, out);
    case 'flags':
      return await handleFlags(options, client, out);
    case 'log':
      return await handleLog(options, client, out);
    case 'drain':
      return await mutate(options, client, 'bit.drain', out, logger);
    case 'shutdown':
      return await mutate(options, client, 'bit.shutdown', out, logger);
    case 'restart':
      return await mutate(options, client, 'bit.restart', out, logger);
    default:
      throw new ConfigurationError(`Unknown fleet subcommand: ${subcommand}`);
  }
}

/**
 * Handle 'fleet list' command
 *
 * Lists all Bits in fleet with tabular formatting.
 *
 * Columns:
 * - BIT: Bit name (padded to 20 chars)
 * - PROFILE: Capability profile (core, gateway, llm, mcp-server)
 * - EXPOSURE: MCP exposure (platform-only, platform+domain, none)
 *
 * @param options - Command options
 * @param client - Fleet client
 * @param out - Output function
 * @returns Array of Bits
 */
async function handleList(
  options: FleetDispatchOptions,
  client: FleetClient,
  out: (line: string) => void
): Promise<any> {
  const bits = await client.list();

  if (options.json) {
    out(JSON.stringify(bits, null, 2));
  } else {
    out('BIT                 PROFILE      EXPOSURE');
    for (const b of bits) {
      out(`${b.name.padEnd(20)}${(b.profile || '-').padEnd(13)}${b.exposure || '-'}`);
    }
  }

  return bits;
}

/**
 * Handle 'fleet config' command
 *
 * Gets Bit configuration:
 * - Default: bit.config.get (raw config)
 * - --describe: bit.config.describe (with descriptions/metadata)
 *
 * @param options - Command options
 * @param client - Fleet client
 * @param out - Output function
 * @returns Config result
 */
async function handleConfig(
  options: FleetDispatchOptions,
  client: FleetClient,
  out: (line: string) => void
): Promise<any> {
  const bit = requireBit(options);
  const tool = options.describe ? 'bit.config.describe' : 'bit.config.get';
  const res = await client.call(bit, tool);
  emit(out, options.json || false, `${bit} ${tool}`, res);
  return res;
}

/**
 * Handle 'fleet flags' command
 *
 * Gets or sets feature flags:
 * - 'get' verb: bit.flags.get [--key <K>]
 * - 'set' verb: bit.flags.set --key <K> [--value <V>]
 *
 * @param options - Command options
 * @param client - Fleet client
 * @param out - Output function
 * @returns Flags result
 * @throws {ConfigurationError} If 'set' without --key
 */
async function handleFlags(
  options: FleetDispatchOptions,
  client: FleetClient,
  out: (line: string) => void
): Promise<any> {
  const bit = requireBit(options);

  // Detect 'set' verb in positionals
  const isSet = options.positionals?.includes('set');

  if (isSet) {
    if (!options.key) {
      throw new ConfigurationError('flags set requires --key <K> [--value <V>]');
    }
    const res = await client.call(bit, 'bit.flags.set', { key: options.key, value: options.value });
    emit(out, options.json || false, `${bit} bit.flags.set`, res);
    return res;
  }

  // Get flags
  const res = await client.call(bit, 'bit.flags.get', options.key ? { key: options.key } : {});
  emit(out, options.json || false, `${bit} bit.flags.get`, res);
  return res;
}

/**
 * Handle 'fleet log' command
 *
 * Sets runtime log level:
 * - Requires --level <error|warn|info|debug>
 *
 * @param options - Command options
 * @param client - Fleet client
 * @param out - Output function
 * @returns Log level result
 * @throws {ConfigurationError} If --level not provided
 */
async function handleLog(
  options: FleetDispatchOptions,
  client: FleetClient,
  out: (line: string) => void
): Promise<any> {
  const bit = requireBit(options);

  if (!options.level) {
    throw new ConfigurationError('log requires --level <error|warn|info|debug>');
  }

  const res = await client.call(bit, 'bit.log.level', { level: options.level });
  emit(out, options.json || false, `${bit} bit.log.level`, res);
  return res;
}
