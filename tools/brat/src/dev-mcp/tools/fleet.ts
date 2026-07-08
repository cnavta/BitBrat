/**
 * Fleet Management Tools
 *
 * Provides MCP tools for fleet discovery and inspection via the universal bit.* control plane.
 */

import { z } from 'zod';
import { ToolDefinition, TargetConnection } from '../types.js';
import { FleetClient } from '../../fleet/fleet-client.js';
import { GatewayTransport } from '../../fleet/transports/gateway-transport.js';
import { FirestoreRegistryReader } from '../../fleet/firestore-registry.js';

/**
 * fleet.list - Enumerate all live Bits in the fleet
 *
 * Discovers Bits from both the fabric (gateway tool list) and the registry (mcp_servers collection).
 * Returns name, profile, exposure metadata for each Bit.
 */
const fleetListSchema = z.object({});

async function fleetListHandler(
  args: z.infer<typeof fleetListSchema>,
  connection: TargetConnection
): Promise<any> {
  // Check if gateway is configured for this target
  if (!connection.gateway || !connection.gateway.url) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'No gateway configured',
          message: `Target '${connection.name}' does not have a gateway URL configured. Fleet operations require gateway access.`,
          hint: 'Configure gateway.url in architecture.yaml targets section, or use persistence tools to query mcp_servers collection directly.'
        }, null, 2)
      }]
    };
  }

  try {
    // Create FleetClient with gateway transport and registry reader
    const transport = new GatewayTransport({
      baseUrl: connection.gateway.url
    });

    const registry = new FirestoreRegistryReader({
      projectId: connection.firestore.projectId,
      databaseId: connection.firestore.databaseId
    });

    const identity = {
      token: connection.gateway.authToken || 'dev-mcp-token',
      roles: ['bit:read'],
      agentName: 'brat-dev-mcp'
    };

    const client = new FleetClient({
      transport,
      identity,
      registry,
      concurrency: 5
    });

    // Discover the fleet
    const bits = await client.list();

    // Clean up
    await transport.close();

    const result = {
      target: connection.name,
      count: bits.length,
      bits: bits.map(b => ({
        name: b.name,
        profile: b.profile || 'unknown',
        exposure: b.exposure || 'unknown',
        platformOnly: b.platformOnly || false
      }))
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'Fleet discovery failed',
          message: error.message || String(error),
          target: connection.name
        }, null, 2)
      }],
      isError: true
    };
  }
}

export const fleetListTool: ToolDefinition = {
  name: 'fleet.list',
  description: 'Enumerate all live Bits in the fleet with their profile and exposure metadata',
  inputSchema: fleetListSchema,
  handler: fleetListHandler
};

/**
 * fleet.info - Get detailed information for a specific Bit or all Bits
 *
 * Calls bit.info on the specified Bit (or all Bits if no name provided).
 * Returns version, uptime, config, capabilities.
 */
const fleetInfoSchema = z.object({
  bit: z.string().optional().describe('Name of the Bit to query (omit for all Bits)')
});

async function fleetInfoHandler(
  args: z.infer<typeof fleetInfoSchema>,
  connection: TargetConnection
): Promise<any> {
  // Check if gateway is configured for this target
  if (!connection.gateway || !connection.gateway.url) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'No gateway configured',
          message: `Target '${connection.name}' does not have a gateway URL configured. Fleet operations require gateway access.`,
          hint: 'Configure gateway.url in architecture.yaml targets section.'
        }, null, 2)
      }]
    };
  }

  try {
    // Create FleetClient
    const transport = new GatewayTransport({
      baseUrl: connection.gateway.url
    });

    const registry = new FirestoreRegistryReader({
      projectId: connection.firestore.projectId,
      databaseId: connection.firestore.databaseId
    });

    const identity = {
      token: connection.gateway.authToken || 'dev-mcp-token',
      roles: ['bit:read'],
      agentName: 'brat-dev-mcp'
    };

    const client = new FleetClient({
      transport,
      identity,
      registry,
      concurrency: 5
    });

    let result: any;

    if (args.bit) {
      // Single Bit query
      try {
        const info = await client.call(args.bit, 'bit.info', {});
        result = {
          target: connection.name,
          bit: args.bit,
          info
        };
      } catch (error: any) {
        result = {
          target: connection.name,
          bit: args.bit,
          error: error.message || String(error),
          status: 'failed'
        };
      }
    } else {
      // All Bits query (fan-out)
      const results = await client.callAll('bit.info', {});
      result = {
        target: connection.name,
        count: results.length,
        bits: results.map(r => ({
          bit: r.bit,
          ok: r.ok,
          info: r.ok ? r.result : undefined,
          error: !r.ok ? r.error : undefined,
          status: r.ok ? 'success' : r.status
        }))
      };
    }

    // Clean up
    await transport.close();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'Fleet info query failed',
          message: error.message || String(error),
          target: connection.name,
          bit: args.bit
        }, null, 2)
      }],
      isError: true
    };
  }
}

export const fleetInfoTool: ToolDefinition = {
  name: 'fleet.info',
  description: 'Get detailed information from bit.info for a specific Bit or all Bits in the fleet',
  inputSchema: fleetInfoSchema,
  handler: fleetInfoHandler
};

/**
 * Export all fleet tools
 */
export const fleetTools: ToolDefinition[] = [
  fleetListTool,
  fleetInfoTool
];
