/**
 * BL-204 — Brat fleet MCP client public surface.
 *
 * Re-exports the transport-agnostic fleet client, its transports (gateway default + direct
 * break-glass), identity/RBAC helpers, the Firestore registry reader, and shared types.
 */
export * from './types';
export * from './rbac-context';
export * from './fleet-client';
export * from './firestore-registry';
export * from './docker-ports';
export { GatewayTransport, parseMcpResult } from './transports/gateway-transport';
export type { McpClientLike, GatewayTransportOptions } from './transports/gateway-transport';
export { DirectTransport, toUpstreamToolName } from './transports/direct-transport';
export type { DirectTransportOptions } from './transports/direct-transport';
