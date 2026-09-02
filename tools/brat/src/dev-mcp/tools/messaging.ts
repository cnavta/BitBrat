/**
 * Messaging Tools
 *
 * Sprint 39: Dev MCP Messaging Tools
 *
 * MCP tools for sending messages and events to BitBrat execution contexts
 * via api-gateway. Enables coding agents to test chat flows, inject events,
 * and emulate different platforms (Discord, Twitch, Slack, Twilio).
 *
 * Tools:
 * - message.send: Send simple chat messages
 * - event.send: Send full InternalEventV2 events (requires event:inject permission)
 *
 * Platform Emulation:
 * - Discord: connector=discord, source=ingress.discord
 * - Twitch: connector=twitch, source=ingress.twitch
 * - Slack: connector=slack, source=ingress.slack
 * - Twilio: connector=twilio, source=ingress.twilio
 * - API: connector=api, source=api-gateway (default)
 */

import { z } from 'zod';
import { randomBytes } from 'crypto';
import { ApiGatewayClient } from '../api-gateway-client.js';
import type { InternalEventV2, ConnectorType } from '../../../../../src/types/events.js';
import { ToolDefinition } from '../types.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Connection context for caching clients and auth tokens
 */
interface ConnectionContext {
  gateway?: {
    client?: ApiGatewayClient;
    url?: string;
    authToken?: string;
  };
  // Allow other properties from TargetConnection
  [key: string]: any;
}

/**
 * Platform emulation preset
 */
interface PlatformPreset {
  connector: ConnectorType;
  source: string;
  identity?: Partial<InternalEventV2['identity']>;
  egress?: Partial<InternalEventV2['egress']>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build platform emulation preset
 *
 * Returns connector, source, identity, and egress defaults for platform emulation.
 *
 * @param platform - Platform name (discord, twitch, slack, twilio, api)
 * @param userId - Optional user ID override
 * @returns Platform preset with defaults
 */
export function buildPlatformPreset(platform: string, userId?: string): PlatformPreset {
  const defaultUserId = userId || 'brat-dev-mcp:chat';

  switch (platform.toLowerCase()) {
    case 'discord':
      return {
        connector: 'discord',
        source: 'ingress.discord',
        identity: {
          external: {
            id: userId || 'dev-mcp-user',
            platform: 'discord',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: 'dev-test-channel',
          connector: 'discord',
        },
      };

    case 'twitch':
      return {
        connector: 'twitch',
        source: 'ingress.twitch',
        identity: {
          external: {
            id: userId || 'dev_mcp_user',
            platform: 'twitch',
            displayName: 'dev_mcp_user',
          },
        },
        egress: {
          destination: 'bitbrat',
          connector: 'twitch',
        },
      };

    case 'slack':
      return {
        connector: 'slack',
        source: 'ingress.slack',
        identity: {
          external: {
            id: userId || 'U12345DEV',
            platform: 'slack',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: 'C12345DEV',
          connector: 'slack',
        },
      };

    case 'twilio':
      return {
        connector: 'twilio',
        source: 'ingress.twilio',
        identity: {
          external: {
            id: userId || '+15555551234',
            platform: 'twilio',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: userId || '+15555551234',
          connector: 'twilio',
        },
      };

    case 'api':
    default:
      return {
        connector: 'api',
        source: 'api-gateway',
        identity: {
          external: {
            id: defaultUserId,
            platform: 'api',
            displayName: 'Dev MCP User',
          },
        },
        egress: {
          destination: defaultUserId,
          connector: 'api',
        },
      };
  }
}

/**
 * Acquire authentication token for api-gateway
 *
 * Checks connection cache first, then environment variables, then generates
 * a development token with warning.
 *
 * Token acquisition strategy:
 * 1. Check connection.gateway.authToken cache
 * 2. Check DEV_MCP_AUTH_TOKEN environment variable
 * 3. Check BITBRAT_AUTH_TOKEN environment variable
 * 4. Generate secure random token (for agent-dev contexts only)
 *
 * **Production contexts** MUST provide BITBRAT_AUTH_TOKEN.
 * **Agent-dev contexts** can use generated tokens.
 *
 * @param connection - Connection context
 * @param contextName - Execution context name
 * @returns Auth token
 */
export async function acquireAuthToken(
  connection: ConnectionContext,
  contextName: string
): Promise<string> {
  // Step 1: Check connection cache
  if (connection.gateway?.authToken) {
    return connection.gateway.authToken;
  }

  // Step 2: Check environment variables
  const envToken = process.env.DEV_MCP_AUTH_TOKEN || process.env.BITBRAT_AUTH_TOKEN;
  if (envToken) {
    // Cache token
    if (!connection.gateway) {
      connection.gateway = {};
    }
    connection.gateway.authToken = envToken;
    return envToken;
  }

  // Step 3: Generate token for agent-dev contexts
  if (contextName.startsWith('agent-dev-')) {
    // Generate secure random token
    const tokenBytes = randomBytes(32);
    const token = `dev-mcp-${tokenBytes.toString('hex')}`;

    // Cache token
    if (!connection.gateway) {
      connection.gateway = {};
    }
    connection.gateway.authToken = token;

    // Log warning about token generation
    console.warn(`[messaging.ts] Generated temporary dev token for ${contextName}`);
    console.warn(`[messaging.ts] For production use, set BITBRAT_AUTH_TOKEN environment variable`);

    return token;
  }

  // Step 4: Error for production contexts without token
  throw new Error(
    `Authentication token required for context "${contextName}". ` +
    `Set BITBRAT_AUTH_TOKEN or DEV_MCP_AUTH_TOKEN environment variable.`
  );
}

/**
 * Get or create ApiGatewayClient for connection
 *
 * Discovers gateway URL, acquires auth token, creates client, and caches in connection.
 *
 * @param connection - Connection context
 * @param contextName - Execution context name
 * @param logger - Logger instance
 * @returns Connected ApiGatewayClient
 */
async function getOrCreateClient(
  connection: ConnectionContext,
  contextName: string,
  logger: any
): Promise<ApiGatewayClient> {
  // Step 1: Check cache
  if (connection.gateway?.client) {
    // Verify client is still connected
    if (connection.gateway.client.isClientConnected()) {
      return connection.gateway.client;
    }
    // Client disconnected, clear cache
    connection.gateway.client = undefined;
  }

  // Step 2: Discover gateway URL
  let gatewayUrl: string;

  if (connection.gateway?.url) {
    // Use cached/configured URL
    gatewayUrl = connection.gateway.url;
  } else {
    // Default URL discovery based on context
    if (contextName.startsWith('agent-dev-')) {
      // Agent-dev contexts default to localhost:3008
      gatewayUrl = 'ws://localhost:3008';
    } else if (contextName === 'local') {
      // Local context defaults to localhost:3008
      gatewayUrl = 'ws://localhost:3008';
    } else {
      // For other contexts, require explicit gateway URL
      throw new Error(
        `Gateway URL not configured for context "${contextName}". ` +
        `Set gateway.url in connection or use agent-dev/local context.`
      );
    }

    // Cache discovered URL
    if (!connection.gateway) {
      connection.gateway = {};
    }
    connection.gateway.url = gatewayUrl;
  }

  // Step 3: Acquire auth token
  const authToken = await acquireAuthToken(connection, contextName);

  // Step 4: Create client with userId 'brat-dev-mcp:chat'
  // This ensures WebSocket connection is registered under the same userId
  // that will be used in message identities (see buildPlatformPreset line 69)
  // Pattern matches auth.ts:285 auto-grant for event:inject permission
  const client = new ApiGatewayClient({
    gatewayUrl,
    authToken,
    userId: 'brat-dev-mcp:chat', // Sprint 39: Pattern triggers event:inject auto-grant
    logger,
  });

  // Step 5: Connect to WebSocket
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Failed to connect to api-gateway at ${gatewayUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // Step 6: Cache client
  connection.gateway.client = client;

  return client;
}

// ============================================================================
// MCP Tools
// ============================================================================

/**
 * message.send - Send simple chat message
 *
 * Sends a chat message to the specified execution context via api-gateway.
 * Supports platform emulation for testing different connectors.
 *
 * @example
 * ```typescript
 * message.send({
 *   context: 'agent-dev-test',
 *   text: 'Hello, world!',
 *   platform: 'discord',
 *   userId: 'test-user-123',
 * })
 * ```
 */
export const messageSendTool: ToolDefinition = {
  name: 'message.send',
  description: 'Send a chat message to an execution context via api-gateway',
  inputSchema: z.object({
    context: z.string().optional().describe('Execution context (local, staging, prod). Defaults to server startup context.'),
    text: z.string().describe('Message text to send'),
    platform: z.enum(['discord', 'twitch', 'slack', 'twilio', 'api']).optional()
      .describe('Platform to emulate (default: api)'),
    userId: z.string().optional()
      .describe('User ID for identity (default: brat-chat:dev-mcp)'),
    waitForResponse: z.boolean().optional()
      .describe('Wait for response from platform (default: true)'),
    timeoutMs: z.number().optional()
      .describe('Timeout in milliseconds (default: 15000)'),
  }),
  handler: async (args, connection?: ConnectionContext) => {
    try {
      // Create simple logger for ApiGatewayClient
      const logger = {
        info: (...args: any[]) => console.log('[message.send]', ...args),
        debug: (...args: any[]) => console.log('[message.send]', ...args),
        warn: (...args: any[]) => console.warn('[message.send]', ...args),
        error: (...args: any[]) => console.error('[message.send]', ...args),
      } as any;

      // Get or create client
      const ctx = connection || {};
      // Use connection.name instead of args.context (context param is stripped by server)
      const contextName = (ctx as any).name || 'local';
      const client = await getOrCreateClient(ctx, contextName, logger);

      // Build platform preset
      const platform = args.platform || 'api';
      const preset = buildPlatformPreset(platform, args.userId);

      // Build message frame
      const correlationId = randomBytes(16).toString('hex');
      const response = await client.sendMessage({
        type: 'chat.message.v1',
        payload: {
          text: args.text,
          connector: preset.connector,
          source: preset.source,
          identity: preset.identity,
          egress: preset.egress,
        },
        metadata: {
          id: correlationId,
        },
        waitForResponse: args.waitForResponse ?? true,
        timeoutMs: args.timeoutMs || 15000,
      });

      // Format response
      if (!response) {
        // Fire-and-forget message
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'sent',
                message: 'Message sent (no response requested)',
                correlationId,
                trace: `Use fleet.trace({ correlationId: "${correlationId}", context: "${contextName}" }) to trace this message`,
                context: contextName,
                platform,
              }, null, 2),
            },
          ],
        };
      }

      // Message with response
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'success',
              correlationId: response.correlationId,
              trace: `Use fleet.trace({ correlationId: "${response.correlationId}", context: "${contextName}" }) to trace this message`,
              context: contextName,
              platform,
              response: {
                type: response.type,
                message: response.message,
                candidates: response.candidates,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // Try to extract correlationId from error context if available
      const errorContext = (error as any).correlationId ?
        `\nCorrelation ID: ${(error as any).correlationId}` : '';

      return {
        content: [
          {
            type: 'text' as const,
            text: `Error sending message: ${error.message}${errorContext}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * event.send - Send full InternalEventV2 event
 *
 * Sends a complete InternalEventV2 event using event.inject.v2 frame type.
 * Bypasses normal ingress normalization and preserves all metadata.
 *
 * **Security**: Requires "event:inject" permission on authentication token.
 *
 * @example
 * ```typescript
 * event.send({
 *   context: 'agent-dev-test',
 *   event: {
 *     type: 'chat.message.v1',
 *     message: { id: 'msg1', role: 'user', text: '!help' },
 *     ingress: { connector: 'discord', source: 'ingress.discord' },
 *     identity: { external: { id: 'user123', platform: 'discord' } },
 *     egress: { destination: 'channel123', connector: 'discord' },
 *   },
 * })
 * ```
 */
export const eventSendTool: ToolDefinition = {
  name: 'event.send',
  description: 'Send a full InternalEventV2 event to an execution context (requires event:inject permission)',
  inputSchema: z.object({
    context: z.string().optional().describe('Execution context (local, staging, prod). Defaults to server startup context.'),
    event: z.union([
      z.string().describe('JSON-serialized InternalEventV2 event'),
      z.object({
        type: z.string().describe('Event type (e.g., chat.message.v1)'),
        message: z.object({
          id: z.string(),
          role: z.enum(['user', 'assistant', 'system', 'tool']),
          text: z.string().optional(),
        }).optional(),
        ingress: z.object({
          connector: z.string(),
          source: z.string(),
          ingressAt: z.string().optional(),
        }).optional(),
        identity: z.object({
          external: z.object({
            id: z.string(),
            platform: z.string(),
            displayName: z.string().optional(),
          }),
        }).optional(),
        egress: z.object({
          destination: z.string(),
          connector: z.string(),
        }).optional(),
        annotations: z.array(z.any()).optional(),
        candidates: z.array(z.any()).optional(),
      }).passthrough(),
    ]).describe('Partial InternalEventV2 structure (object or JSON string)'),
    waitForResponse: z.boolean().optional()
      .describe('Wait for response (default: true)'),
    timeoutMs: z.number().optional()
      .describe('Timeout in milliseconds (default: 15000)'),
  }),
  handler: async (args, connection?: ConnectionContext) => {
    try {
      // Create simple logger for ApiGatewayClient
      const logger = {
        info: (...args: any[]) => console.log('[event.send]', ...args),
        debug: (...args: any[]) => console.log('[event.send]', ...args),
        warn: (...args: any[]) => console.warn('[event.send]', ...args),
        error: (...args: any[]) => console.error('[event.send]', ...args),
      } as any;

      // Get or create client
      const ctx = connection || {};
      // Use connection.name instead of args.context (context param is stripped by server)
      const contextName = (ctx as any).name || 'local';
      const client = await getOrCreateClient(ctx, contextName, logger);

      // Parse event if it's a JSON string
      let event: Partial<InternalEventV2>;
      if (typeof args.event === 'string') {
        try {
          event = JSON.parse(args.event);
        } catch (err) {
          throw new Error(
            `Failed to parse event JSON: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } else {
        event = args.event;
      }

      // Add default ingressAt if not provided
      if (event.ingress && !event.ingress.ingressAt) {
        event.ingress.ingressAt = new Date().toISOString();
      }

      // Send event using event.inject.v2
      const response = await client.sendEvent({
        event: event as Partial<InternalEventV2>,
        waitForResponse: args.waitForResponse ?? true,
        timeoutMs: args.timeoutMs || 15000,
      });

      // Format response
      if (!response) {
        // Fire-and-forget event
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'sent',
                message: 'Event sent (no response requested)',
                context: contextName,
                eventType: args.event.type,
              }, null, 2),
            },
          ],
        };
      }

      // Event with response
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'success',
              context: contextName,
              eventType: args.event.type,
              response: {
                type: response.type,
                correlationId: response.correlationId,
                message: response.message,
                candidates: response.candidates,
                annotations: response.annotations,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error sending event: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

// ============================================================================
// Tool Exports
// ============================================================================

/**
 * All messaging tools
 */
export const messagingTools: ToolDefinition[] = [
  messageSendTool,
  eventSendTool,
];
