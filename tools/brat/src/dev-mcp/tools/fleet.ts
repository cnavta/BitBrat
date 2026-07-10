/**
 * Fleet Management Tools
 *
 * Provides MCP tools for fleet discovery and inspection via the universal bit.* control plane.
 */

import { z } from 'zod';
import { ToolDefinition, TargetConnection, LogEntry, TraceTimeline, TimelineEntry } from '../types.js';
import { FleetClient } from '../../fleet/fleet-client.js';
import { GatewayTransport } from '../../fleet/transports/gateway-transport.js';
import { FirestoreRegistryReader } from '../../fleet/firestore-registry.js';
import { LogRetriever } from '../log-retriever.js';
import { formatText, formatJson, formatRaw, formatTimeline, formatTraceJson } from '../log-formatter.js';

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
 * fleet.logs - Retrieve logs from specific Bit(s)
 *
 * Supports Cloud Run (Cloud Logging API) and Docker (docker compose logs) targets.
 * Provides filtering by level, time range, and correlation ID.
 */
const fleetLogsSchema = z.object({
  bit: z.string().optional().describe('Name of the Bit to query logs from (omit for all Bits)'),
  level: z.array(z.enum(['error', 'warn', 'info', 'debug', 'trace'])).optional()
    .describe('Log levels to include (if empty, all levels)'),
  since: z.string().optional()
    .describe('Start time (ISO timestamp or duration like "1h", "30m")'),
  until: z.string().optional()
    .describe('End time (ISO timestamp)'),
  limit: z.number().default(100)
    .describe('Maximum number of log entries to return'),
  correlationId: z.string().optional()
    .describe('Filter by correlation ID'),
  format: z.enum(['text', 'json', 'raw']).default('text')
    .describe('Output format')
});

async function fleetLogsHandler(
  args: Record<string, any>,
  connection: TargetConnection
): Promise<any> {
  try {
    // Parse and validate args
    const parsed = fleetLogsSchema.parse(args);
    // Create LogRetriever
    const logRetriever = new LogRetriever(connection);

    if (parsed.bit) {
      // Single-bit query
      const response = await logRetriever.getLogs({
        bit: parsed.bit,
        level: parsed.level,
        since: parsed.since,
        until: parsed.until,
        limit: parsed.limit,
        correlationId: parsed.correlationId
      });

      // Check for errors
      if (response.error) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Log retrieval failed',
              message: response.error,
              bit: parsed.bit,
              target: connection.name
            }, null, 2)
          }],
          isError: true
        };
      }

      // Format output
      let formattedOutput: string;
      switch (parsed.format) {
        case 'json':
          formattedOutput = formatJson(response.logs);
          break;
        case 'raw':
          formattedOutput = formatRaw(response.logs);
          break;
        case 'text':
        default:
          formattedOutput = formatText(response.logs);
          break;
      }

      const header = `Retrieved ${response.count} log entries from ${args.bit} (${response.deploymentType})\nTarget: ${connection.name}\n\n`;

      return {
        content: [{
          type: 'text' as const,
          text: header + formattedOutput
        }]
      };
    } else {
      // Fleet-wide query (--all mode)
      // Get all Bits from fleet
      const transport = new GatewayTransport({
        baseUrl: connection.gateway?.url || ''
      });

      const registry = new FirestoreRegistryReader({
        projectId: connection.firestore.projectId,
        databaseId: connection.firestore.databaseId
      });

      const identity = {
        token: connection.gateway?.authToken || 'dev-mcp-token',
        roles: ['bit:read'],
        agentName: 'brat-dev-mcp'
      };

      const fleetClient = new FleetClient({
        transport,
        identity,
        registry,
        concurrency: 5
      });

      const bits = await fleetClient.list();

      // Query logs from each Bit in parallel with concurrency limit
      const concurrency = 5;
      const allResults: Array<{ bit: string; response: any; error?: string }> = [];

      for (let i = 0; i < bits.length; i += concurrency) {
        const batch = bits.slice(i, i + concurrency);
        const batchResults = await Promise.all(
          batch.map(async (bit) => {
            try {
              const response = await logRetriever.getLogs({
                bit: bit.name,
                level: args.level,
                since: args.since,
                until: args.until,
                limit: args.limit,
                correlationId: args.correlationId
              });
              return { bit: bit.name, response };
            } catch (error: any) {
              return { bit: bit.name, response: null, error: error.message };
            }
          })
        );
        allResults.push(...batchResults);
      }

      // Clean up
      await transport.close();

      // Aggregate results
      const successful = allResults.filter(r => !r.error && !r.response?.error);
      const failed = allResults.filter(r => r.error || r.response?.error);

      let output = `Fleet-wide log query (${bits.length} Bits)\nTarget: ${connection.name}\n\n`;
      output += `Successful: ${successful.length}, Failed: ${failed.length}\n\n`;

      // Show logs from successful queries
      for (const result of successful) {
        if (result.response && result.response.count > 0) {
          output += `=== ${result.bit} (${result.response.count} entries, ${result.response.deploymentType}) ===\n`;

          let formattedLogs: string;
          switch (parsed.format) {
            case 'json':
              formattedLogs = formatJson(result.response.logs);
              break;
            case 'raw':
              formattedLogs = formatRaw(result.response.logs);
              break;
            case 'text':
            default:
              formattedLogs = formatText(result.response.logs);
              break;
          }

          output += formattedLogs + '\n\n';
        }
      }

      // Show failures
      if (failed.length > 0) {
        output += `\n=== Failures ===\n`;
        for (const result of failed) {
          output += `${result.bit}: ${result.error || result.response?.error}\n`;
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: output
        }]
      };
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'Fleet logs query failed',
          message: error.message || String(error),
          bit: args.bit,
          target: connection.name
        }, null, 2)
      }],
      isError: true
    };
  }
}

export const fleetLogsTool: ToolDefinition = {
  name: 'fleet.logs',
  description: 'Retrieve logs from specific Bit(s) - supports Cloud Run and Docker targets with filtering by level, time range, and correlation ID',
  inputSchema: fleetLogsSchema,
  handler: fleetLogsHandler
};

/**
 * Build timeline from collected logs
 *
 * Merges logs from multiple services, sorts by timestamp,
 * calculates relative timings, and builds TraceTimeline structure.
 */
function buildTimeline(logs: LogEntry[], correlationId: string): TraceTimeline {
  // Sort logs by timestamp (ascending)
  const sortedLogs = [...logs].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  // Calculate relative timestamps from first log
  const firstTimestamp = new Date(sortedLogs[0].timestamp).getTime();
  const lastTimestamp = new Date(sortedLogs[sortedLogs.length - 1].timestamp).getTime();
  const duration = lastTimestamp - firstTimestamp;

  // Extract unique service names
  const services = Array.from(new Set(sortedLogs.map(log => log.service).filter(Boolean))) as string[];

  // Build timeline entries
  const timeline: TimelineEntry[] = sortedLogs.map(log => {
    const logTimestamp = new Date(log.timestamp).getTime();
    const relativeMs = logTimestamp - firstTimestamp;

    return {
      relativeMs,
      service: log.service || 'unknown',
      level: log.level,
      message: log.message || log.msg || '',
      timestamp: log.timestamp
    };
  });

  return {
    correlationId,
    duration,
    services,
    timeline
  };
}

/**
 * fleet.trace - Distributed trace reconstruction by correlation ID
 *
 * Queries all Bits in the fleet for logs matching a correlation ID,
 * then reconstructs the request flow across services with timing information.
 */
const fleetTraceSchema = z.object({
  correlationId: z.string().describe('Correlation ID to trace across the fleet'),
  format: z.enum(['timeline', 'json']).default('timeline')
    .describe('Output format (timeline or json)')
});

async function fleetTraceHandler(
  args: Record<string, any>,
  connection: TargetConnection
): Promise<any> {
  try {
    // Parse and validate args
    const parsed = fleetTraceSchema.parse(args);

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

    // Create FleetClient to discover Bits
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

    const fleetClient = new FleetClient({
      transport,
      identity,
      registry,
      concurrency: 5
    });

    // Discover all Bits in the fleet
    const bits = await fleetClient.list();

    // Create LogRetriever
    const logRetriever = new LogRetriever(connection);

    // Query logs from each Bit with correlation ID filter
    const concurrency = 5;
    const allLogs: LogEntry[] = [];

    for (let i = 0; i < bits.length; i += concurrency) {
      const batch = bits.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (bit) => {
          try {
            const response = await logRetriever.getLogs({
              bit: bit.name,
              correlationId: parsed.correlationId,
              limit: 1000  // Higher limit for traces
            });
            return response.logs || [];
          } catch (error: any) {
            // Silently ignore errors - some Bits may not have logs
            return [];
          }
        })
      );

      // Flatten and collect logs
      for (const logs of batchResults) {
        allLogs.push(...logs);
      }
    }

    // Clean up
    await transport.close();

    // Check if any logs were found
    if (allLogs.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: 'No logs found',
            message: `No logs found for correlation ID '${parsed.correlationId}' across ${bits.length} Bits`,
            correlationId: parsed.correlationId,
            target: connection.name
          }, null, 2)
        }]
      };
    }

    // Build timeline from collected logs
    const timeline = buildTimeline(allLogs, parsed.correlationId);

    // Format output based on format parameter
    let formattedOutput: string;
    if (parsed.format === 'json') {
      formattedOutput = formatTraceJson(timeline);
    } else {
      formattedOutput = formatTimeline(timeline);
    }

    return {
      content: [{
        type: 'text' as const,
        text: formattedOutput
      }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'Fleet trace query failed',
          message: error.message || String(error),
          correlationId: args.correlationId,
          target: connection.name
        }, null, 2)
      }],
      isError: true
    };
  }
}

export const fleetTraceTool: ToolDefinition = {
  name: 'fleet.trace',
  description: 'Reconstruct distributed trace across all Bits by correlation ID',
  inputSchema: fleetTraceSchema,
  handler: fleetTraceHandler
};

/**
 * Export all fleet tools
 */
export const fleetTools: ToolDefinition[] = [
  fleetListTool,
  fleetInfoTool,
  fleetLogsTool,
  fleetTraceTool
];
