/**
 * BL-204 — Brat fleet MCP client: shared types.
 *
 * Brat becomes a *consumer* of the universal `bit.*` control plane (shipped sprint-324). These types
 * describe the transport-agnostic surface the `brat fleet` commands drive. Per ADR-003 the default
 * path is the `tool-gateway` fabric; `--direct` is a documented break-glass to a single Bit.
 */

/** Identity forwarded to the gateway/Bit so RBAC (server-authoritative) can allow/deny. */
export interface FleetIdentity {
  /** Resolved bearer token (MCP_AUTH_TOKEN-style). Required to engage — fail-closed (OQ3). */
  token: string;
  /** Roles forwarded via MCP `_meta.userRoles` (e.g. bit:read / bit:operate). */
  roles: string[];
  /** Optional operator user id forwarded via `_meta.userId`. */
  userId?: string;
  /** The calling agent name (defaults to `brat`). */
  agentName: string;
}

/** A tool as discovered through the fabric (gateway ListTools / GET /v1/tools). */
export interface FleetTool {
  /** The (possibly Bit-qualified) discovery id, e.g. `mcp:auth/bit.health` or `mcp:story.generate`. */
  id: string;
  /** Human-friendly name (unqualified tool name), e.g. `bit.health`. */
  name?: string;
  description?: string;
}

/** A live Bit as rendered by `brat fleet list`. */
export interface FleetBit {
  /** Registry key / Bit name (the qualifier used in `mcp:<bit>/bit.*`). */
  name: string;
  /** Composition profile (core | llm | mcp-domain | gateway), when known from the registry. */
  profile?: string;
  /** MCP exposure (platform-only | platform+domain), when known from the registry. */
  exposure?: string;
  /** Last-known health string, when probed. */
  health?: string;
  /** True when the Bit has only the platform (`bit.*`) surface and no domain tools. */
  platformOnly?: boolean;
}

/**
 * Classification of a failed `bit.*` call, so the CLI can render an accurate status instead of
 * conflating every failure with connectivity. `forbidden` is a server-authoritative RBAC denial
 * (the Bit is reachable but the operator identity is not authorized — supply elevated `--roles`);
 * `unreachable` is a transport/connection failure (the Bit is down or not reachable); `error` is any
 * other operational failure surfaced by the Bit.
 */
export type FleetCallStatus = 'forbidden' | 'unreachable' | 'error';

/** Result of a single `bit.*` call against one Bit. */
export interface FleetCallResult {
  bit: string;
  ok: boolean;
  /** Parsed/raw result payload when ok. */
  result?: any;
  /** Error message when not ok (e.g. `Forbidden`, `connect ECONNREFUSED ...`). */
  error?: string;
  /** Classified failure kind when not ok (drives accurate CLI labeling). */
  status?: FleetCallStatus;
}

/**
 * A transport drives MCP discovery + invocation. The gateway transport (default) aggregates the
 * fleet behind one chokepoint; the direct transport targets a single Bit (break-glass). FleetClient
 * is written against this interface so it is transport-agnostic.
 */
export interface FleetTransport {
  /** Human label for logs/audit (`gateway` | `direct:<bit>`). */
  readonly label: string;
  /** Enumerate tools visible to the identity. */
  listTools(identity: FleetIdentity): Promise<FleetTool[]>;
  /** Invoke a tool by its (qualified) discovery id, forwarding identity via `_meta`. */
  callTool(toolId: string, args: Record<string, any>, identity: FleetIdentity): Promise<any>;
  /** Release any underlying connection. */
  close(): Promise<void>;
}

/** A registry entry as self-published by a Bit on boot (Firestore `mcp_servers`). */
export interface RegistryEntry {
  name: string;
  url?: string;
  profile?: string;
  exposure?: string;
  transport?: string;
  /**
   * How the entry got into `mcp_servers`. Bits self-register over the internal bus and the
   * tool-gateway stamps `discoverySource: 'auto-registration'`; manually-added external MCP servers
   * (e.g. a stdio web-search tool) carry no such marker. Used to keep non-Bit MCP servers out of the
   * fleet (they do not expose the `bit.*` control plane).
   */
  discoverySource?: string;
}

/** Reads the live registry of Bits (Firestore `mcp_servers`), used for discovery + `--direct` lookup. */
export interface RegistryReader {
  listServers(): Promise<RegistryEntry[]>;
}
