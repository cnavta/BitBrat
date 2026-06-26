import { createLogger, Logger } from '../orchestration/logger';
import { ConfigurationError, PermissionError } from '../orchestration/errors';
import {
  FleetClient,
  FleetIdentity,
  FleetTransport,
  RegistryReader,
  GatewayTransport,
  DirectTransport,
  FirestoreRegistryReader,
  resolveIdentity,
  resolveServiceHostPort,
  rewriteToLocalHostPort,
  classifyFleetError,
} from '../fleet';
import { resolveBackupConnection, ResolvedBackupConnection } from '../backup/connection';
import { FirestoreConnectOptions } from '../providers/gcp/firestore';

/** The tool-gateway's internal container port (it publishes on a mapped host port locally). */
const GATEWAY_CONTAINER_PORT = 3000;

/**
 * BL-204 §4.1 / Appendix A — the `brat fleet` command group.
 *
 * Turns Brat into a fleet MCP client over the universal `bit.*` control plane. Default path is the
 * `tool-gateway` fabric (ADR-003); `--direct <bit>` is an explicit, audited, single-Bit break-glass
 * (OQ4). Read ops need `bit:read`; mutating ops need `bit:operate` — RBAC is server-authoritative, so
 * Brat only forwards identity and never self-authorizes. `--all` fans out READ-only; fleet-wide
 * mutations require `--confirm` and run sequentially.
 */

interface FleetArgs {
  /** Subcommand: list | info | health | config | flags | log | drain | shutdown. */
  sub: string;
  /** Positional args after the subcommand (e.g. the Bit name, or `get`/`set`). */
  positionals: string[];
  all: boolean;
  confirm: boolean;
  describe: boolean;
  json: boolean;
  direct?: string;
  key?: string;
  value?: string;
  level?: string;
  roles?: string[];
  userId?: string;
  /** Deployment target name (e.g. `local` | `staging`) — selects the emulator-backed registry. */
  target?: string;
  /** Explicit project id / emulator host / database overrides (parity with `brat backup`). */
  projectId?: string;
  emulatorHost?: string;
  database?: string;
}

/** A read subcommand needs only bit:read; mutating subcommands need bit:operate. */
const READ_SUBS = new Set(['list', 'info', 'health', 'config']);
const MUTATING_SUBS = new Set(['log', 'drain', 'shutdown']);

/** Injectable seams so the command is unit-testable without real network / Firestore. */
export interface FleetDeps {
  resolveIdentityFn?: (opts: { roles?: string[]; userId?: string }, logger?: Logger) => FleetIdentity;
  gatewayTransportFactory?: (baseUrl: string, identity: FleetIdentity, logger?: Logger) => FleetTransport;
  directTransportFactory?: (
    bit: string,
    registry: RegistryReader,
    logger?: Logger,
    urlRewriter?: (url: string, bit: string) => string,
  ) => FleetTransport;
  /**
   * Resolve a local Docker compose service's published host port (`<SVC>_HOST_PORT` env → `docker ps`
   * probe → fallback). Injectable for tests; defaults to {@link resolveServiceHostPort}.
   */
  hostPortResolverFn?: (service: string, containerPort: number, logger?: Logger) => number;
  /** Build the registry reader from the resolved Firestore connection (target-aware). */
  registryFactory?: (connect: FirestoreConnectOptions, logger?: Logger) => RegistryReader;
  /**
   * Resolve a deployment-target (`--target`) to its Firestore connection (emulator for docker
   * stacks). Defaults to the same resolver `brat backup` uses, so `--target local` points the
   * registry at the local emulator rather than real GCP.
   */
  connectionResolverFn?: (
    flags: { projectId?: string; env?: string },
    m: Record<string, string>,
    logger?: Logger,
  ) => Promise<ResolvedBackupConnection>;
  /** Sink for printed output (defaults to console.log). */
  out?: (line: string) => void;
}

const FLEET_HELP = `brat fleet — drive the universal bit.* control plane across the fleet

Usage:
  brat fleet list                          enumerate live Bits (name, profile, exposure)
  brat fleet info     [<bit> | --all]      bit.info
  brat fleet health   [<bit> | --all]      bit.health
  brat fleet config   <bit> [--describe]   bit.config.get / bit.config.describe (secrets redacted)
  brat fleet flags    <bit> get [--key K]  bit.flags.get
  brat fleet flags    <bit> set --key K --value V    bit.flags.set      (elevated: bit:operate)
  brat fleet log      <bit> --level <error|warn|info|debug>   bit.log.level   (elevated)
  brat fleet drain    <bit> [--confirm]    bit.drain          (elevated)
  brat fleet shutdown <bit> [--confirm]    bit.shutdown       (elevated)

Global modifiers:
  --all              fan out across every discovered Bit (READ-only; mutations need --confirm)
  --direct <bit>     BREAK-GLASS: bypass the gateway, connect directly to one Bit (audited; never with --all)
  --confirm          required for fleet-wide / high-blast-radius mutations
  --json             machine-readable output
  --target <name>    select a docker deployment target (e.g. local | staging); reads that stack's
                     Firestore emulator registry instead of real GCP
  --env <name>       select environment (reuses the global flag + BITBRAT_ENV)

Notes:
  • Default path is the tool-gateway fabric (one auth/RBAC/discovery chokepoint).
  • --target maps to a docker-engine target in architecture.yaml; the local stack runs the Firestore
    emulator, so discovery reads mcp_servers from it (not GCP). Without --target, GCP/ADC is used.
  • For a LOCAL docker --target, the gateway (and any --direct Bit) is reached on its PUBLISHED host
    port — resolved from <SERVICE>_HOST_PORT or a "docker ps" probe (e.g. localhost:3001), not the
    internal :3000. Set TOOL_GATEWAY_URL / --url to override the gateway endpoint explicitly.
  • --direct is emergency-only (gateway unhealthy / isolating a misbehaving Bit); it is logged as fleet.break_glass.
  • Commands fail closed: without a resolvable MCP_AUTH_TOKEN they refuse to run.`;

/** Parse the raw cli `cmd`/`rest`/global flags into a normalized FleetArgs. */
export function parseFleetArgs(cmd: string[], rest: string[], flags: any): FleetArgs {
  const m: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    m[key] = v !== undefined ? v : 'true';
  }
  const rolesRaw = (m['roles'] || process.env.MCP_ROLES || '').trim();
  return {
    sub: cmd[1] || '',
    positionals: cmd.slice(2),
    all: rest.includes('--all') || m['all'] === 'true',
    confirm: rest.includes('--confirm') || m['confirm'] === 'true',
    describe: rest.includes('--describe') || m['describe'] === 'true',
    json: !!flags?.json,
    direct: m['direct'] && m['direct'] !== 'true' ? m['direct'] : undefined,
    key: m['key'],
    value: m['value'],
    level: m['level'],
    roles: rolesRaw ? rolesRaw.split(/[\s,]+/).filter(Boolean) : undefined,
    userId: m['user-id'] || process.env.MCP_USER_ID || undefined,
    target: m['target'] && m['target'] !== 'true' ? m['target'] : undefined,
    projectId: m['project-id'] && m['project-id'] !== 'true' ? m['project-id'] : undefined,
    emulatorHost: m['emulator-host'] && m['emulator-host'] !== 'true' ? m['emulator-host'] : undefined,
    database: m['database'] && m['database'] !== 'true' ? m['database'] : undefined,
  };
}

function defaultDeps(): Required<Omit<FleetDeps, 'out'>> & { out: (l: string) => void } {
  return {
    resolveIdentityFn: (opts, logger) => resolveIdentity(opts, logger),
    gatewayTransportFactory: (baseUrl, _identity, logger) => new GatewayTransport({ baseUrl, logger }),
    directTransportFactory: (bit, registry, logger, urlRewriter) =>
      new DirectTransport({ bit, registry, logger, urlRewriter }),
    registryFactory: (connect, logger) => new FirestoreRegistryReader(connect, logger),
    connectionResolverFn: (flags, m, logger) => resolveBackupConnection(flags, m, logger),
    hostPortResolverFn: (service, containerPort, logger) =>
      resolveServiceHostPort(service, { containerPort, logger }),
    out: (line: string) => console.log(line),
  };
}

/**
 * Execute a `brat fleet` invocation. Returns a structured result (for tests); also prints output.
 * Throws BratError subclasses (mapped to non-zero exit codes by the CLI) on guardrail violations.
 */
export async function runFleet(args: FleetArgs, flags: any, logger: Logger, deps: FleetDeps = {}): Promise<any> {
  const d = { ...defaultDeps(), ...deps };
  const out = deps.out || d.out;

  if (!args.sub || args.sub === 'help' || args.sub === '--help') {
    out(FLEET_HELP);
    return { help: true };
  }

  const isMutating = MUTATING_SUBS.has(args.sub) || (args.sub === 'flags' && args.positionals.includes('set'));
  const isRead = READ_SUBS.has(args.sub) || (args.sub === 'flags' && !args.positionals.includes('set'));
  if (!isMutating && !isRead) {
    out(FLEET_HELP);
    throw new ConfigurationError(`Unknown fleet subcommand: ${args.sub}`);
  }

  // --direct guardrails (OQ4): single-Bit only, never with --all.
  if (args.direct && args.all) {
    throw new ConfigurationError('--direct cannot be combined with --all (break-glass targets a single Bit).');
  }

  // Identity: forward operator roles; default scope hint by command class (server is authoritative).
  const roles = args.roles && args.roles.length ? args.roles : (isMutating ? ['bit:operate'] : ['bit:read']);
  const identity = d.resolveIdentityFn({ roles, userId: args.userId }, logger); // throws PermissionError (fail-closed) if no token

  // Resolve the registry's Firestore connection. With `--target` we map a docker deployment target
  // to its (emulator) endpoint exactly as `brat backup` does — so e.g. `--target local` reads the
  // local Firestore emulator's `mcp_servers` registry instead of real GCP (the root cause of the
  // `5 NOT_FOUND` / `twitch-452523` failure). Without `--target`, honor explicit project/emulator/
  // database overrides and otherwise fall back to ADC/env.
  let connectOptions: FirestoreConnectOptions = {
    projectId: args.projectId,
    emulatorHost: args.emulatorHost,
    databaseId: args.database,
  };
  let connectionCleanup: (() => Promise<void>) | undefined;
  // True when `--target` resolved to a *local* docker engine (unix socket). Only then can we probe
  // `docker ps` on this machine to remap services from their internal container port to the
  // operator-reachable published host port. (Remote/ssh targets are left to their published URLs.)
  let isLocalDocker = false;
  if (args.target) {
    const m: Record<string, string> = { target: args.target };
    if (args.projectId) m['project-id'] = args.projectId;
    if (args.emulatorHost) m['emulator-host'] = args.emulatorHost;
    if (args.database) m['database'] = args.database;
    const resolved = await d.connectionResolverFn({ projectId: flags?.projectId, env: flags?.env }, m, logger);
    connectOptions = resolved.connectOptions;
    connectionCleanup = resolved.cleanup;
    isLocalDocker = resolved.targetKind === 'local';
    logger.info(
      { action: 'fleet.target.resolved', target: args.target, isEmulator: resolved.isEmulator, kind: resolved.targetKind },
      `Fleet registry resolved to ${resolved.description}`,
    );
  }

  const registry = d.registryFactory(connectOptions, logger);

  // Transport selection: fabric by default, direct break-glass behind --direct.
  let transport: FleetTransport;
  if (args.direct) {
    logger.warn(
      { action: 'fleet.break_glass', bit: args.direct, by: identity.userId || identity.agentName, sub: args.sub },
      `BREAK-GLASS: bypassing the gateway to reach Bit '${args.direct}' directly (operator '${identity.userId || identity.agentName}').`,
    );
    // For a local docker target, remap the Bit's internal registry URL to its published host port
    // (using the same injectable resolver as the gateway URL).
    const urlRewriter = isLocalDocker
      ? (url: string, bit: string) =>
          rewriteToLocalHostPort(url, bit, {
            logger,
            resolveHostPort: (service, containerPort) =>
              d.hostPortResolverFn(service, containerPort ?? GATEWAY_CONTAINER_PORT, logger),
          })
      : undefined;
    transport = d.directTransportFactory(args.direct, registry, logger, urlRewriter);
  } else {
    const baseUrl = resolveGatewayUrl(flags, connectOptions, isLocalDocker ? d.hostPortResolverFn : undefined, logger);
    transport = d.gatewayTransportFactory(baseUrl, identity, logger);
  }

  const client = new FleetClient({ transport, identity, registry, logger, concurrency: flags?.concurrency });

  try {
    return await dispatch(args, client, out, logger);
  } finally {
    await client.close();
    if (connectionCleanup) {
      try {
        await connectionCleanup();
      } catch {
        /* best-effort teardown of any tunnel opened for a remote --target */
      }
    }
  }
}

/**
 * Resolve the tool-gateway base URL. An explicit `--url` / `TOOL_GATEWAY_URL` always wins. For a
 * local docker `--target`, the gateway runs on the host's *published* port (`TOOL_GATEWAY_HOST_PORT`,
 * e.g. `localhost:3001` — `deploy-local.sh` may auto-assign it), NOT the internal `3000`; resolve it
 * via the host-port resolver instead of the old hardcoded `:3000`. Otherwise derive the host from any
 * resolved emulator host (still defaulting the port to 3000 for non-docker stacks).
 */
function resolveGatewayUrl(
  flags: any,
  connect?: FirestoreConnectOptions,
  hostPortResolverFn?: (service: string, containerPort: number, logger?: Logger) => number,
  logger?: Logger,
): string {
  const explicit = (flags?.url || process.env.TOOL_GATEWAY_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  // Local docker target: the gateway is reachable on its published host port (not the internal 3000).
  if (hostPortResolverFn) {
    const port = hostPortResolverFn('tool-gateway', GATEWAY_CONTAINER_PORT, logger);
    return `http://localhost:${port}`;
  }

  const emulatorHost = connect?.emulatorHost?.trim();
  if (emulatorHost) {
    const host = emulatorHost.split(':')[0] || 'localhost';
    const gwHost = host === '0.0.0.0' ? 'localhost' : host;
    return `http://${gwHost}:${GATEWAY_CONTAINER_PORT}`;
  }
  return `http://localhost:${GATEWAY_CONTAINER_PORT}`;
}

/** The single Bit target for a non-`--all` command (first positional that isn't a verb). */
function targetBit(args: FleetArgs): string | undefined {
  if (args.direct) return args.direct;
  return args.positionals.find((p) => p !== 'get' && p !== 'set');
}

function requireBit(args: FleetArgs): string {
  const bit = targetBit(args);
  if (!bit) throw new ConfigurationError(`This command requires a <bit> (or use --all where supported).`);
  return bit;
}

function emit(out: (l: string) => void, json: boolean, label: string, payload: any) {
  if (json) {
    out(JSON.stringify(payload, null, 2));
  } else {
    out(`${label}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
}

async function dispatch(args: FleetArgs, client: FleetClient, out: (l: string) => void, logger: Logger): Promise<any> {
  switch (args.sub) {
    case 'list': {
      const bits = await client.list();
      if (args.json) out(JSON.stringify(bits, null, 2));
      else {
        out('BIT                 PROFILE      EXPOSURE');
        for (const b of bits) out(`${b.name.padEnd(20)}${(b.profile || '-').padEnd(13)}${b.exposure || '-'}`);
      }
      return bits;
    }
    case 'info':
      return readOrAll(args, client, 'bit.info', out);
    case 'health':
      return readOrAll(args, client, 'bit.health', out);
    case 'config': {
      const bit = requireBit(args);
      const tool = args.describe ? 'bit.config.describe' : 'bit.config.get';
      const res = await client.call(bit, tool);
      emit(out, args.json, `${bit} ${tool}`, res);
      return res;
    }
    case 'flags': {
      const bit = requireBit(args);
      if (args.positionals.includes('set')) {
        if (!args.key) throw new ConfigurationError('flags set requires --key <K> [--value <V>]');
        const res = await client.call(bit, 'bit.flags.set', { key: args.key, value: args.value });
        emit(out, args.json, `${bit} bit.flags.set`, res);
        return res;
      }
      const res = await client.call(bit, 'bit.flags.get', args.key ? { key: args.key } : {});
      emit(out, args.json, `${bit} bit.flags.get`, res);
      return res;
    }
    case 'log': {
      const bit = requireBit(args);
      if (!args.level) throw new ConfigurationError('log requires --level <error|warn|info|debug>');
      const res = await client.call(bit, 'bit.log.level', { level: args.level });
      emit(out, args.json, `${bit} bit.log.level`, res);
      return res;
    }
    case 'drain':
      return mutate(args, client, 'bit.drain', out, logger);
    case 'shutdown':
      return mutate(args, client, 'bit.shutdown', out, logger);
    default:
      throw new ConfigurationError(`Unknown fleet subcommand: ${args.sub}`);
  }
}

/**
 * Render a failed `--all` row, labeling it by its classified status so an RBAC denial is no longer
 * conflated with a connectivity failure: `forbidden (...)` (reachable but unauthorized — supply
 * elevated --roles), `unreachable (...)` (Bit down/not reachable), or `error (...)` (other failure).
 */
function renderFailure(r: { status?: string; error?: string }): string {
  const detail = r.error || 'unknown';
  switch (r.status) {
    case 'forbidden':
      return `forbidden (${detail})`;
    case 'error':
      return `error (${detail})`;
    case 'unreachable':
    default:
      return `unreachable (${detail})`;
  }
}

/** When any rows were RBAC-denied, hint that elevated roles may be required (non-JSON output only). */
function forbiddenHint(out: (l: string) => void, results: Array<{ ok: boolean; status?: string }>): void {
  if (results.some((r) => !r.ok && r.status === 'forbidden')) {
    out(
      'note: "forbidden" means the Bit is reachable but your identity lacks the required scope. ' +
        'Re-run with elevated roles, e.g. --roles bit:operate (RBAC is server-authoritative).',
    );
  }
}

/** Read op: single Bit, or fan out read-only across the fleet with --all. */
async function readOrAll(args: FleetArgs, client: FleetClient, tool: string, out: (l: string) => void): Promise<any> {
  if (args.all) {
    const results = await client.callAll(tool);
    if (args.json) out(JSON.stringify(results, null, 2));
    else {
      out(`BIT                 ${tool}`);
      for (const r of results) out(`${r.bit.padEnd(20)}${r.ok ? JSON.stringify(r.result) : renderFailure(r)}`);
      forbiddenHint(out, results);
    }
    return results;
  }
  const bit = requireBit(args);
  const res = await client.call(bit, tool);
  emit(out, args.json, `${bit} ${tool}`, res);
  return res;
}

/**
 * Mutating op. A single-Bit mutation runs on the fabric by default. A fleet-wide (`--all`) mutation
 * is high-blast-radius: it is NOT implied by --all alone — it demands an explicit --confirm and runs
 * SEQUENTIALLY with per-Bit logging. A Forbidden response surfaces and does not retry.
 */
async function mutate(args: FleetArgs, client: FleetClient, tool: string, out: (l: string) => void, logger: Logger): Promise<any> {
  if (args.all) {
    if (!args.confirm) {
      throw new ConfigurationError(
        `Fleet-wide ${tool} is high blast radius and is not implied by --all. Re-run with --confirm to proceed.`,
      );
    }
    const bits = await client.list();
    const results: Array<{ bit: string; ok: boolean; result?: any; error?: string; status?: string }> = [];
    for (const b of bits) {
      try {
        logger.info({ action: 'fleet.mutate', tool, bit: b.name }, `Applying ${tool} to '${b.name}'`);
        const result = await client.call(b.name, tool);
        results.push({ bit: b.name, ok: true, result });
      } catch (e: any) {
        const msg = e?.message || String(e);
        const status = classifyFleetError(msg);
        results.push({ bit: b.name, ok: false, status, error: status === 'forbidden' ? 'Forbidden' : msg });
      }
    }
    if (args.json) out(JSON.stringify(results, null, 2));
    else {
      for (const r of results) out(`${r.bit.padEnd(20)}${r.ok ? 'ok' : `failed (${renderFailure(r)})`}`);
      forbiddenHint(out, results);
    }
    return results;
  }
  const bit = requireBit(args);
  const res = await client.call(bit, tool);
  emit(out, args.json, `${bit} ${tool}`, res);
  return res;
}

/** CLI entrypoint wrapper invoked from `cli/index.ts`. */
export async function cmdFleet(cmd: string[], rest: string[], flags: any): Promise<void> {
  const logger = createLogger({ base: { component: 'brat-fleet' } });
  const args = parseFleetArgs(cmd, rest, flags);
  await runFleet(args, flags, logger);
}

export { PermissionError };
