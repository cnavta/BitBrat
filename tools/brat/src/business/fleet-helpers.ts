/**
 * Business Logic: Fleet Command Helpers
 * Sprint 360: Extracted from cli/fleet.ts
 *
 * Common helper functions for fleet commands.
 * Handles single-Bit operations, --all fan-out, RBAC-aware output formatting.
 *
 * Used by:
 * - All 7 fleet commands
 * - FleetCommand base class
 */

import type { Logger } from '../orchestration/logger';
import type { FleetClient } from '../fleet';
import { ConfigurationError } from '../orchestration/errors';
import { classifyFleetError } from '../fleet';

/**
 * Fleet command arguments (simplified for business logic)
 */
export interface FleetCommandArgs {
  /**
   * Target Bit name (from positional arg or --direct)
   */
  bit?: string;

  /**
   * All Bits flag (--all)
   */
  all?: boolean;

  /**
   * JSON output flag (--json)
   */
  json?: boolean;

  /**
   * Confirmation flag (--confirm, required for mutating --all)
   */
  confirm?: boolean;

  /**
   * Direct break-glass Bit (--direct <bit>)
   */
  direct?: string;

  /**
   * Positional arguments (for extracting Bit name)
   */
  positionals?: string[];
}

/**
 * Extract the target Bit name from arguments
 *
 * Priority:
 * 1. --direct flag (break-glass mode)
 * 2. First positional that isn't a verb (get/set)
 *
 * @param args - Command arguments
 * @returns Bit name or undefined
 */
export function targetBit(args: FleetCommandArgs): string | undefined {
  if (args.direct) return args.direct;
  if (args.bit) return args.bit;
  return args.positionals?.find((p) => p !== 'get' && p !== 'set');
}

/**
 * Require a target Bit name (throws if missing)
 *
 * @param args - Command arguments
 * @returns Bit name
 * @throws {ConfigurationError} If no Bit specified
 */
export function requireBit(args: FleetCommandArgs): string {
  const bit = targetBit(args);
  if (!bit) {
    throw new ConfigurationError(`This command requires a <bit> (or use --all where supported).`);
  }
  return bit;
}

/**
 * Emit output in JSON or labeled format
 *
 * @param out - Output function
 * @param json - JSON mode flag
 * @param label - Label for non-JSON output
 * @param payload - Data to output
 */
export function emit(out: (line: string) => void, json: boolean, label: string, payload: any): void {
  if (json) {
    out(JSON.stringify(payload, null, 2));
  } else {
    out(`${label}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
}

/**
 * Render a failed --all row with status classification
 *
 * Classifies failures as:
 * - `forbidden (...)` - Reachable but unauthorized (RBAC denial)
 * - `unreachable (...)` - Bit down or not reachable
 * - `error (...)` - Other failure
 *
 * @param result - Failure result with status and error
 * @returns Formatted failure string
 */
export function renderFailure(result: { status?: string; error?: string }): string {
  const detail = result.error || 'unknown';
  switch (result.status) {
    case 'forbidden':
      return `forbidden (${detail})`;
    case 'error':
      return `error (${detail})`;
    case 'unreachable':
    default:
      return `unreachable (${detail})`;
  }
}

/**
 * Show RBAC hint if any forbidden errors occurred
 *
 * Displays a note about elevated roles for non-JSON output.
 *
 * @param out - Output function
 * @param results - Array of results with status
 */
export function forbiddenHint(
  out: (line: string) => void,
  results: Array<{ ok: boolean; status?: string }>
): void {
  if (results.some((r) => !r.ok && r.status === 'forbidden')) {
    out(
      'note: "forbidden" means the Bit is reachable but your identity lacks the required scope. ' +
        'Re-run with elevated roles, e.g. --roles bit:operate (RBAC is server-authoritative).'
    );
  }
}

/**
 * Read operation result (single Bit)
 */
export interface ReadResult {
  /**
   * Operation succeeded
   */
  ok: boolean;

  /**
   * Result data (if ok)
   */
  result?: any;

  /**
   * Error message (if not ok)
   */
  error?: string;

  /**
   * Status classification (forbidden, unreachable, error)
   */
  status?: string;
}

/**
 * Read operation result (--all)
 */
export interface ReadAllResult {
  /**
   * Target Bit name
   */
  bit: string;

  /**
   * Operation succeeded
   */
  ok: boolean;

  /**
   * Result data (if ok)
   */
  result?: any;

  /**
   * Error message (if not ok)
   */
  error?: string;

  /**
   * Status classification (forbidden, unreachable, error)
   */
  status?: string;
}

/**
 * Execute read operation (single Bit or --all fan-out)
 *
 * Read operations:
 * - Single Bit: Call tool, emit result
 * - --all: Fan out to all Bits, collect results, show forbidden hint
 *
 * @param args - Command arguments
 * @param client - Fleet client
 * @param tool - MCP tool name (e.g., 'bit.info', 'bit.health')
 * @param out - Output function
 * @returns Result(s)
 */
export async function readOrAll(
  args: FleetCommandArgs,
  client: FleetClient,
  tool: string,
  out: (line: string) => void
): Promise<any> {
  if (args.all) {
    const results = await client.callAll(tool);
    if (args.json) {
      out(JSON.stringify(results, null, 2));
    } else {
      out(`BIT                 ${tool}`);
      for (const r of results) {
        out(`${r.bit.padEnd(20)}${r.ok ? JSON.stringify(r.result) : renderFailure(r)}`);
      }
      forbiddenHint(out, results);
    }
    return results;
  }

  const bit = requireBit(args);
  const res = await client.call(bit, tool);
  emit(out, args.json || false, `${bit} ${tool}`, res);
  return res;
}

/**
 * Execute mutating operation (single Bit or --all with confirmation)
 *
 * Mutating operations:
 * - Single Bit: Call tool, emit result
 * - --all: Requires --confirm, runs sequentially with per-Bit logging
 *
 * High blast radius protection:
 * - --all ALONE is rejected (must add --confirm)
 * - Sequential execution (not parallel)
 * - Per-Bit logging
 * - Forbidden errors surfaced (no retry)
 *
 * @param args - Command arguments
 * @param client - Fleet client
 * @param tool - MCP tool name (e.g., 'bit.drain', 'bit.shutdown')
 * @param out - Output function
 * @param logger - Logger
 * @returns Result(s)
 * @throws {ConfigurationError} If --all without --confirm
 */
export async function mutate(
  args: FleetCommandArgs,
  client: FleetClient,
  tool: string,
  out: (line: string) => void,
  logger: Logger
): Promise<any> {
  if (args.all) {
    if (!args.confirm) {
      throw new ConfigurationError(
        `Fleet-wide ${tool} is high blast radius and is not implied by --all. Re-run with --confirm to proceed.`
      );
    }

    const bits = await client.list();
    const results: Array<{
      bit: string;
      ok: boolean;
      result?: any;
      error?: string;
      status?: string;
    }> = [];

    for (const b of bits) {
      try {
        logger.info({ action: 'fleet.mutate', tool, bit: b.name }, `Applying ${tool} to '${b.name}'`);
        const result = await client.call(b.name, tool);
        results.push({ bit: b.name, ok: true, result });
      } catch (e: any) {
        const msg = e?.message || String(e);
        const status = classifyFleetError(msg);
        results.push({
          bit: b.name,
          ok: false,
          status,
          error: status === 'forbidden' ? 'Forbidden' : msg,
        });
      }
    }

    if (args.json) {
      out(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        out(`${r.bit.padEnd(20)}${r.ok ? 'ok' : `failed (${renderFailure(r)})`}`);
      }
      forbiddenHint(out, results);
    }
    return results;
  }

  const bit = requireBit(args);
  const res = await client.call(bit, tool);
  emit(out, args.json || false, `${bit} ${tool}`, res);
  return res;
}
