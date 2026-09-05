import { Bit } from '../common/base-server';
import { getFirestore } from '../common/firebase';
import { INTERNAL_MCP_REGISTRATION_V1, InternalEventV2 } from '../types/events';
import type { Firestore } from 'firebase-admin/firestore';
import type { IDocumentStore } from '../common/persistence/interfaces';
import {
  createContextPackStore,
  type IContextPackStore,
  type ContextPackDocument
} from './context-pack-service';
import { Express, Request, Response } from 'express';
import { Server } from "@modelcontextprotocol/server";
import { ToolRegistry } from '../services/llm-bot/tools/registry';
import { McpClientManager } from '../common/mcp/client-manager';
import { RegistryWatcher } from '../common/mcp/registry-watcher';
import { RbacEvaluator } from '../common/mcp/rbac';
import { CompositionRegistry } from '../common/composition/registry';
import { CompositionExecutor } from '../common/composition/executor';
import { CompositionWatcher } from '../common/composition/composition-watcher';
import { PostgresCompositionStore } from '../common/composition/postgres-composition-store';
import { McpServerConfig, SessionContext } from '../common/mcp/types';
import {
  createMcpServerStore,
  type IMcpServerStore,
  type McpServerDocument,
  FirestoreMcpServerStore,
  DocumentStoreMcpServerStore
} from '../common/mcp/mcp-server-store';
import { normalizeError } from '../common/mcp/error-utils';
import {
  embedText,
  buildEmbeddingText,
  StaticContextProvider,
  resolveContextPacks,
  packsToNamedContexts,
  type ContextActiveSet,
  type ContextPack,
} from '../common/context';
import type { NamedContext } from '../common/prompt-assembly/types';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const SERVICE_NAME = process.env.SERVICE_NAME || 'tool-gateway';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

/**
 * Schema for agent.sendProgressUpdate tool.
 * Allows agents to send progress messages to users before long-running operations.
 * Sprint 22: Platform-internal progress update tool.
 */
const SendProgressUpdateSchema = z.object({
  message: z.string().describe('Progress message to send to the user (1-200 characters)'),
  emoji: z.string().optional().describe('Optional emoji to prepend to the message (default: 🔄)'),
  urgency: z.enum(['low', 'normal', 'high']).optional().describe('Message urgency level (default: normal)'),
  egress: z.object({
    destination: z.string(),
    connector: z.string(),
    channel: z.string().optional(),
    type: z.enum(['chat', 'dm', 'event']).optional(),
  }).optional().describe('Egress from the original event (recommended for accurate routing). If omitted, will be constructed from userId.'),
});

type SendProgressUpdateArgs = z.infer<typeof SendProgressUpdateSchema>;

/**
 * Schemas for composition administrative MCP tools (Sprint 41 - COMP-017A)
 * These tools provide MCP-based management of compositions, complementing the REST API.
 */

// composition.register schema
const CompositionRegisterSchema = z.object({
  definition: z.object({
    apiVersion: z.string().describe('API version (e.g., "mcp-compose/v1")'),
    kind: z.literal('Composition').describe('Resource kind (must be "Composition")'),
    metadata: z.object({
      name: z.string().describe('Composition name (unique identifier)'),
      description: z.string().optional().describe('Human-readable description'),
      version: z.number().optional().describe('Version number (auto-assigned if omitted)'),
    }).passthrough().describe('Composition metadata'),
    spec: z.object({
      inputSchema: z.any().describe('JSON Schema for composition inputs'),
      steps: z.array(z.any()).optional().describe('Execution steps (call, ifValue, etc.)'),
      return: z.any().describe('Return value definition'),
    }).passthrough().describe('Composition specification'),
  }).passthrough().describe('Composition definition (YAML/JSON)'),
});

type CompositionRegisterArgs = z.infer<typeof CompositionRegisterSchema>;

// composition.list schema
const CompositionListSchema = z.object({
  filter: z.object({
    name: z.string().optional().describe('Filter by composition name'),
    status: z.enum(['active', 'draft', 'archived']).optional().describe('Filter by status'),
  }).optional().describe('Optional filters for composition list'),
  limit: z.number().optional().describe('Maximum number of results to return'),
  offset: z.number().optional().describe('Number of results to skip (pagination)'),
});

type CompositionListArgs = z.infer<typeof CompositionListSchema>;

// composition.get schema
const CompositionGetSchema = z.object({
  name: z.string().describe('Composition name to retrieve'),
  version: z.number().optional().describe('Specific version to retrieve (omit for latest)'),
});

type CompositionGetArgs = z.infer<typeof CompositionGetSchema>;

// composition.delete schema
const CompositionDeleteSchema = z.object({
  name: z.string().describe('Composition name to delete'),
  version: z.number().describe('Specific version to delete'),
});

type CompositionDeleteArgs = z.infer<typeof CompositionDeleteSchema>;

// composition.stats schema (no parameters)
const CompositionStatsSchema = z.object({});

type CompositionStatsArgs = z.infer<typeof CompositionStatsSchema>;

// composition.list_tools schema - Helper for discovering canonical tool IDs (Sprint 41 remediation)
const CompositionListToolsSchema = z.object({
  filter: z.string().optional().describe('Optional filter pattern (e.g., "state", "image") to search tool names'),
  limit: z.number().optional().describe('Maximum number of tools to return (default: 100)'),
});

type CompositionListToolsArgs = z.infer<typeof CompositionListToolsSchema>;

export class ToolGatewayServer extends Bit {
  private registry = new ToolRegistry();
  private mcpManager = new McpClientManager(this as any, this.registry);
  private registryWatcher?: RegistryWatcher;
  private serverConfigs: Map<string, McpServerConfig> = new Map();
  private rbac = new RbacEvaluator();
  // Just-in-Time Context Provisioning (sprint-328, P2): context packs/bindings advertised by each
  // registered Bit on INTERNAL_MCP_REGISTRATION_V1, keyed by Bit name. Used to resolve which packs
  // to inject for an active tool set at tool-turn context build (de-duplicated by pack id).
  private contextProviders: Map<string, StaticContextProvider> = new Map();
  // Signature of the last meaningful registration payload persisted to Firestore, keyed by Bit name.
  // Bits re-publish their registration on a heartbeat; without this guard every heartbeat rewrites the
  // mcp_servers doc (stamping a fresh updatedAt/correlationId), which fires the RegistryWatcher's
  // onSnapshot and re-loads every server on a tight loop. We only write when the meaningful payload
  // actually changes, breaking the write -> snapshot -> reload feedback loop.
  private registrationSignatures: Map<string, string> = new Map();
  // Active MCP session servers (connected clients like llm-bot). Used to broadcast tool/resource/prompt
  // list change notifications when new Bits register and their tools are discovered. Each session is
  // keyed by a unique ID (e.g., `llm-bot-${timestamp}`). Cleanup happens when transport closes.
  private sessionServers: Map<string, Server> = new Map();
  // Session contexts: Track active sessions with their current event context (Sprint 22).
  // Keyed by sessionId, value contains SessionContext + currentEvent for agent.sendProgressUpdate tool.
  private sessionContexts: Map<string, SessionContext & { currentEvent?: InternalEventV2; sessionId?: string }> = new Map();
  // Request deduplication: Track in-flight tool executions to prevent duplicate execution
  // caused by MCP SDK message duplication bug. Maps dedup key to Promise of the result.
  // This allows multiple handler invocations to await the same execution.
  private inFlightRequests: Map<string, Promise<any>> = new Map();
  // Track completion timestamps for cleanup
  private completedRequests: Map<string, number> = new Map();
  // Repository abstractions for persistence (Firestore or PostgreSQL via factory)
  private mcpServerStore: IMcpServerStore;
  private contextPackStore: IContextPackStore;
  // Composition subsystem (Sprint 41)
  private compositionRegistry?: CompositionRegistry;
  private compositionExecutor?: CompositionExecutor;
  private compositionsEnabled: boolean;
  // Composition hot-reload watcher (Sprint 42)
  private compositionWatcher?: any; // CompositionWatcher (imported below)

  constructor() {
    super({ serviceName: SERVICE_NAME, mcpExposure: 'platform+domain' });

    // Sprint 27: Inject logger into ToolRegistry for TRACE debugging
    this.registry.setLogger(this.getLogger());

    // Initialize repositories (backend auto-detection via factory)
    // Use documentStore for PostgreSQL or fallback to Firestore
    const documentStore = this.getResource('documentStore');
    const db = this.getResource('firestore');
    let dbOrStore = documentStore || db;

    // If no resources available, try getFirestore() for test environments
    // that mock firebase directly
    if (!dbOrStore) {
      try {
        const { getFirestore } = require('../common/firebase');
        dbOrStore = getFirestore();
      } catch (err) {
        // Ignore - will fall back to in-memory store
      }
    }

    this.mcpServerStore = createMcpServerStore(dbOrStore);
    this.contextPackStore = createContextPackStore(dbOrStore);

    // Initialize composition subsystem (Sprint 41)
    // Feature flag: ENABLE_COMPOSITIONS (default: true)
    this.compositionsEnabled = process.env.ENABLE_COMPOSITIONS !== 'false';

    if (this.compositionsEnabled) {
      try {
        // Create PostgresCompositionStore for dedicated compositions table
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error('DATABASE_URL required for composition subsystem');
        }

        const { Pool } = require('pg');
        const pool = new Pool({
          connectionString,
          max: parseInt(process.env.POSTGRES_POOL_SIZE || '10', 10),
          ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        });

        const compositionStore = new PostgresCompositionStore(pool);

        // Note: Table verification happens on first use
        // Migration 023-add-compositions-table.sql creates the table

        // Create adapter for ToolRegistry to match ToolRegistryInterface
        const toolRegistryAdapter = {
          getTool: (toolId: string) => {
            const tool = this.registry.getTool(toolId);
            if (!tool) return null;
            return {
              id: tool.id,
              inputSchema: tool.inputSchema,
              source: tool.source,
              execute: tool.execute,
              outputSchema: (tool as any).outputSchema,
            };
          },
        };

        this.compositionRegistry = new CompositionRegistry(
          compositionStore as any, // DocumentStore interface compatible
          toolRegistryAdapter as any
        );
        this.compositionExecutor = new CompositionExecutor(toolRegistryAdapter as any);

        this.getLogger().info('tool_gateway.composition.subsystem_initialized', {
          storeType: 'PostgresCompositionStore',
          connectionString: connectionString.replace(/:[^:@]+@/, ':***@'), // Mask password
        });
      } catch (err) {
        this.getLogger().warn('tool_gateway.composition.init_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.compositionsEnabled = false;
      }
    }

    this.setupApp(this.getApp() as any);

    // Register tool-gateway-specific tools after setup
    this.registerGatewayTools();

    // Register composition administrative MCP tools (Sprint 41 - COMP-017A)
    // CRITICAL: Always register tools even when disabled, so LLMs get clear error messages
    // instead of empty responses (fixes empty string bug discovered in Sprint 41 verification)
    this.registerCompositionAdminTools();
  }

  /**
   * Helper method to register a tool-gateway platform tool in BOTH registries.
   *
   * This prevents the common mistake of only registering in one place:
   * - Internal registry (this.registry) - for REST API and internal resolution
   * - MCP server (this.registerTool) - for MCP client visibility
   *
   * Sprint 41: Codifies dual-registration pattern to prevent MCP exposure bugs.
   *
   * @param id Tool ID
   * @param description Tool description
   * @param schema Zod schema for validation
   * @param handler Tool execution handler
   */
  private registerPlatformTool<T extends z.ZodType>(
    id: string,
    description: string,
    schema: T,
    handler: (args: z.infer<T>, extra?: any) => Promise<any>
  ): void {
    // 1. Register in internal ToolRegistry (for REST API + tool resolution)
    this.registry.registerTool({
      id,
      displayName: id,
      description,
      inputSchema: schema,
      execute: handler,
      source: 'internal',
    });

    // 2. Register via Bit MCP interface (for MCP client exposure)
    // Only exposed if mcpExposure is set (checked by base class)
    this.registerTool(id, description, schema, handler);
  }

  /**
   * Register tool-gateway-specific MCP tools.
   * Sprint 22: agent.sendProgressUpdate for sending progress messages before long operations.
   */
  protected registerGatewayTools(): void {
    this.registerPlatformTool(
      'agent.sendProgressUpdate',
      'Send a progress update message to the user before starting a long-running operation. Use this to provide immediate feedback when an action may take more than a few seconds.',
      SendProgressUpdateSchema,
      this.handleSendProgressUpdate.bind(this)
    );

    this.getLogger().info('tool_gateway.platform_tools.registered', {
      tools: ['agent.sendProgressUpdate']
    });
  }

  /**
   * Handle agent.sendProgressUpdate tool invocation.
   * Creates a progress event with the message in candidates[] and routes it via next()
   * to respect platform safeguards (FeedbackMiddleware, candidate selection, egress).
   * Sprint 22: Platform-internal progress update tool.
   */
  private async handleSendProgressUpdate(
    args: SendProgressUpdateArgs,
    extra?: { sessionId?: string; userRoles?: string[]; userId?: string; agentName?: string; correlationId?: string }
  ): Promise<any> {
    const logger = this.getLogger();
    const sessionId = extra?.sessionId || '';
    const userId = extra?.userId;
    const correlationId = extra?.correlationId;

    logger.debug('tool_gateway.send_progress_update.invoked', {
      sessionId,
      correlationId,
      messageLength: args.message.length,
      emoji: args.emoji,
      urgency: args.urgency,
      userId,
    });

    // Prefer egress from args (if agent provided it), otherwise retrieve from claim check
    let egressInfo: any;
    let platform: string;
    let externalId: string;
    let sourceEvent: InternalEventV2 | null = null;

    // Try to retrieve source event from claim check if correlationId available
    if (!args.egress && correlationId) {
      try {
        // Get the claim.event.retrieve tool from registry
        const claimTool = this.registry.getTool('claim.event.retrieve');

        if (claimTool && claimTool.execute) {
          // Call claim check to retrieve source event
          const claimResult = await claimTool.execute(
            { correlationId },
            { sessionId, userRoles: extra?.userRoles || [] }
          );

          if (claimResult && !claimResult.isError) {
            // Parse the event from the response
            const content = claimResult.content?.[0];
            if (content && content.type === 'text') {
              try {
                sourceEvent = JSON.parse(content.text);
                logger.debug('tool_gateway.send_progress_update.claim_check_retrieved', {
                  correlationId,
                  hasSourceEvent: !!sourceEvent,
                });
              } catch (parseErr) {
                logger.warn('tool_gateway.send_progress_update.claim_parse_failed', {
                  correlationId,
                  error: parseErr instanceof Error ? parseErr.message : String(parseErr),
                });
              }
            }
          }
        } else {
          logger.debug('tool_gateway.send_progress_update.claim_tool_not_found', {
            correlationId,
            note: 'claim.event.retrieve tool not registered yet',
          });
        }
      } catch (claimErr) {
        // Claim check failed - not critical, fall back to other methods
        logger.warn('tool_gateway.send_progress_update.claim_check_failed', {
          correlationId,
          error: claimErr instanceof Error ? claimErr.message : String(claimErr),
        });
      }
    }

    // Use egress from source event if retrieved
    if (sourceEvent && sourceEvent.egress) {
      platform = sourceEvent.egress.connector;
      externalId = sourceEvent.identity?.external?.id || 'unknown';

      egressInfo = {
        ...sourceEvent.egress,
        destination: sourceEvent.egress.destination || 'internal.egress.v1',
      };

      logger.debug('tool_gateway.send_progress_update.using_claim_check_egress', {
        correlationId,
        destination: egressInfo.destination,
        connector: egressInfo.connector,
        channel: egressInfo.channel,
        externalId,
      });
    } else if (args.egress) {
      // Use egress from original event (ideal path - preserves exact routing)
      // The destination may be a specific egress instance (e.g., "egress.slack.v1")
      // or the generic fallback ("internal.egress.v1")
      platform = args.egress.connector;

      // Validate and normalize destination
      let destination = args.egress.destination;
      if (!destination || !destination.includes('.')) {
        // Invalid destination (e.g., just "slack" instead of "egress.slack.v1")
        // Fall back to internal.egress.v1
        logger.warn('tool_gateway.send_progress_update.invalid_destination', {
          sessionId,
          providedDestination: destination,
          normalizedTo: 'internal.egress.v1',
        });
        destination = 'internal.egress.v1';
      }

      egressInfo = {
        ...args.egress,  // Preserve ALL egress fields
        destination,     // Override with validated/normalized destination
      };

      // Extract externalId from userId if available
      if (userId) {
        const parts = userId.split(':', 2);
        externalId = parts[1] || userId;
      } else {
        externalId = 'unknown';
      }

      logger.debug('tool_gateway.send_progress_update.using_provided_egress', {
        sessionId,
        destination: egressInfo.destination,
        connector: egressInfo.connector,
        channel: egressInfo.channel,
      });
    } else {
      // Fallback: construct from userId (backward compatibility)
      if (!userId) {
        const warning = 'No userId in request context and no egress parameter - cannot determine egress destination';
        logger.warn('tool_gateway.send_progress_update.no_egress_info', {
          sessionId,
          extra,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Warning: ${warning}. The progress message was not sent.`,
            },
          ],
        };
      }

      // Extract platform from userId (format: "platform:id", e.g. "slack:U9S817Q3B")
      const parts = userId.split(':', 2);
      platform = parts[0];
      externalId = parts[1];

      if (!platform || !externalId) {
        const warning = `Invalid userId format: "${userId}" (expected "platform:id")`;
        logger.warn('tool_gateway.send_progress_update.invalid_user_id', {
          sessionId,
          userId,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Warning: ${warning}. The progress message was not sent.`,
            },
          ],
        };
      }

      egressInfo = {
        destination: 'internal.egress.v1',
        connector: platform,
        channel: 'unknown', // Will be resolved by egress handler
      };

      logger.debug('tool_gateway.send_progress_update.using_userid_fallback', {
        sessionId,
        userId,
        platform,
      });
    }

    // Build progress event from available context
    const progressMessage = `${args.emoji || '🔄'} ${args.message}`;
    // Reuse existing correlationId if available, otherwise generate new one
    const progressCorrelationId = correlationId || randomUUID();

    const progressEvent: InternalEventV2 = {
      v: '2',
      correlationId: progressCorrelationId,
      type: 'chat.message.v1',
      ingress: {
        connector: platform as any,
        source: `ingress.${platform}`,
        ingressAt: new Date().toISOString(),
        channel: egressInfo.channel, // Use channel from egress
      },
      identity: {
        user: {
          id: userId || `${platform}:${externalId}`,
          displayName: 'User',
          roles: extra?.userRoles || [],
        },
        external: {
          id: externalId,
          platform,
        },
      },
      egress: egressInfo as any, // Use egress from context or fallback
      message: {
        id: randomUUID(),
        role: 'assistant',
        text: progressMessage,
      },
      routing: {
        stage: 'response',
        slip: [], // Empty slip signals Bit.next() to route to egress destination
        history: [],
      },
      candidates: [
        {
          id: randomUUID(),
          kind: 'text',
          source: 'tool-gateway',
          status: 'proposed',
          text: progressMessage,
          priority: 1.0,
          createdAt: new Date().toISOString(),
        },
      ],
      annotations: [
        {
          kind: 'progress_update',
          value: JSON.stringify({
            urgency: args.urgency || 'normal',
            toolInvocation: 'agent.sendProgressUpdate',
          }),
          source: 'tool-gateway',
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        },
      ],
    };

    // Route through platform safeguards via next()
    try {
      logger.trace('tool_gateway.send_progress_update.calling_next', {
        sessionId,
        progressCorrelationId: progressEvent.correlationId,
        hasRoutingSlip: progressEvent.routing?.slip !== undefined,
        slipLength: progressEvent.routing?.slip?.length || 0,
      });

      await this.next(progressEvent);

      logger.trace('tool_gateway.send_progress_update.sent', {
        sessionId,
        progressCorrelationId: progressEvent.correlationId,
        messagePreview: progressMessage.slice(0, 50),
        urgency: args.urgency || 'normal',
        platform,
        userId,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Progress update sent: "${progressMessage}"`,
          },
        ],
      };
    } catch (error: any) {
      logger.error('tool_gateway.send_progress_update.error', {
        sessionId,
        progressCorrelationId: correlationId,
        platform,
        userId,
        error: error.message,
        stack: error.stack,
      });

      // Don't throw - return error as content to prevent agent failure
      return {
        content: [
          {
            type: 'text',
            text: `Error sending progress update: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * Register composition administrative MCP tools (Sprint 41 - COMP-017A).
   * Provides MCP-based CRUD operations for compositions, complementing the REST API.
   * Tools reuse existing REST endpoint logic for consistency.
   */
  private registerCompositionAdminTools(): void {
    const logger = this.getLogger();

    // Register all composition admin tools using the helper method
    // This ensures they're exposed via BOTH internal registry AND MCP
    this.registerPlatformTool(
      'composition.register',
      `Register a new composition from YAML/JSON definition.

IMPORTANT: Tool IDs in composition steps MUST use CANONICAL names (e.g., 'get_state', 'generate_image'), NOT the MCP-prefixed names you see in the tools list (e.g., 'mcp_get_state', 'mcp_generate_image').

Use 'composition.list_tools' to discover canonical tool IDs for composition authoring.

Example:
  steps:
    - call: get_state              # ✅ CORRECT (canonical ID)
      with: { key: "example" }
    - call: mcp_get_state          # ❌ WRONG (MCP-prefixed)

Returns composition metadata (id, name, version, contentHash).`,
      CompositionRegisterSchema,
      this.handleCompositionRegister.bind(this)
    );

    this.registerPlatformTool(
      'composition.list',
      'List all registered compositions with optional filtering and pagination. Returns array of composition metadata.',
      CompositionListSchema,
      this.handleCompositionList.bind(this)
    );

    this.registerPlatformTool(
      'composition.get',
      'Retrieve a specific composition by name and optional version (latest if omitted). Returns full composition definition.',
      CompositionGetSchema,
      this.handleCompositionGet.bind(this)
    );

    this.registerPlatformTool(
      'composition.delete',
      'Delete a specific composition version by name and version number. Returns deletion confirmation.',
      CompositionDeleteSchema,
      this.handleCompositionDelete.bind(this)
    );

    this.registerPlatformTool(
      'composition.stats',
      'Get composition registry statistics including total compositions, total versions, and compositions by name. Returns statistics object.',
      CompositionStatsSchema,
      this.handleCompositionStats.bind(this)
    );

    this.registerPlatformTool(
      'composition.list_tools',
      'List all available tools with CANONICAL IDs for use in compositions. Returns tools with their canonical IDs (without mcp_ prefix), descriptions, and input schemas. Use this to discover correct tool IDs when authoring compositions.',
      CompositionListToolsSchema,
      this.handleCompositionListTools.bind(this)
    );

    logger.info('tool_gateway.composition_admin_tools.registered', {
      tools: ['composition.register', 'composition.list', 'composition.get', 'composition.delete', 'composition.stats', 'composition.list_tools'],
    });
  }

  /**
   * Handle composition.register tool invocation.
   * Registers a new composition from YAML/JSON definition.
   * Sprint 41 (COMP-017A): MCP administrative tool.
   */
  private async handleCompositionRegister(
    args: CompositionRegisterArgs,
    extra?: { sessionId?: string; userRoles?: string[] }
  ): Promise<any> {
    const logger = this.getLogger();

    if (!this.compositionsEnabled || !this.compositionRegistry) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Composition subsystem not enabled (DocumentStore not available)',
          },
        ],
        isError: true,
      };
    }

    logger.debug('composition_admin.register.start', {
      name: args.definition.metadata.name,
      sessionId: extra?.sessionId,
    });

    try {
      // Register composition (same logic as REST POST /v1/compositions)
      // Cast to any because Zod schema uses z.string() for apiVersion but type requires literal "mcp-compose/v1"
      const compiled = await this.compositionRegistry.register(args.definition as any);

      // Register as MCP tool
      await this.registerCompositionTool(compiled);

      logger.info('composition_admin.register.success', {
        name: compiled.metadata.name,
        version: compiled.metadata.version,
        id: compiled.id,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: compiled.id,
                name: compiled.metadata.name,
                version: compiled.metadata.version,
                contentHash: compiled.contentHash,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      logger.error('composition_admin.register.error', {
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : 'Failed to register composition'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle composition.list tool invocation.
   * Lists all registered compositions with optional filtering.
   * Sprint 41 (COMP-017A): MCP administrative tool.
   */
  private async handleCompositionList(
    args: CompositionListArgs,
    extra?: { sessionId?: string; userRoles?: string[] }
  ): Promise<any> {
    const logger = this.getLogger();

    if (!this.compositionsEnabled || !this.compositionRegistry) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Composition subsystem not enabled (DocumentStore not available)',
          },
        ],
        isError: true,
      };
    }

    logger.debug('composition_admin.list.start', {
      filter: args.filter,
      sessionId: extra?.sessionId,
    });

    try {
      // List compositions (same logic as REST GET /v1/compositions)
      const compositions = await this.compositionRegistry.list();

      // Apply optional filters
      let filtered = compositions;

      if (args.filter?.name) {
        filtered = filtered.filter((c) => c.name === args.filter!.name);
      }

      // Apply pagination
      const offset = args.offset || 0;
      const limit = args.limit || filtered.length;
      const paginated = filtered.slice(offset, offset + limit);

      const result = {
        compositions: paginated.map((c) => ({
          id: c.id,
          name: c.name,
          version: c.version,
          contentHash: c.contentHash,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        total: filtered.length,
      };

      logger.debug('composition_admin.list.success', {
        total: result.total,
        returned: result.compositions.length,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      logger.error('composition_admin.list.error', {
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : 'Failed to list compositions'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle composition.get tool invocation.
   * Retrieves a specific composition by name and optional version.
   * Sprint 41 (COMP-017A): MCP administrative tool.
   */
  private async handleCompositionGet(
    args: CompositionGetArgs,
    extra?: { sessionId?: string; userRoles?: string[] }
  ): Promise<any> {
    const logger = this.getLogger();

    if (!this.compositionsEnabled || !this.compositionRegistry) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Composition subsystem not enabled (DocumentStore not available)',
          },
        ],
        isError: true,
      };
    }

    logger.debug('composition_admin.get.start', {
      name: args.name,
      version: args.version,
      sessionId: extra?.sessionId,
    });

    try {
      // Get composition (same logic as REST GET /v1/compositions/:name/:version or /:name)
      const composition = await this.compositionRegistry.get(args.name, args.version);

      if (!composition) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Composition not found: ${args.name}${args.version ? ` (version ${args.version})` : ''}`,
            },
          ],
          isError: true,
        };
      }

      logger.debug('composition_admin.get.success', {
        name: args.name,
        version: composition.metadata.version,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(composition, null, 2),
          },
        ],
      };
    } catch (err) {
      logger.error('composition_admin.get.error', {
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : 'Failed to retrieve composition'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle composition.delete tool invocation.
   * Deletes a specific composition version by name and version.
   * Sprint 41 (COMP-017A): MCP administrative tool.
   */
  private async handleCompositionDelete(
    args: CompositionDeleteArgs,
    extra?: { sessionId?: string; userRoles?: string[] }
  ): Promise<any> {
    const logger = this.getLogger();

    if (!this.compositionsEnabled || !this.compositionRegistry) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Composition subsystem not enabled (DocumentStore not available)',
          },
        ],
        isError: true,
      };
    }

    logger.debug('composition_admin.delete.start', {
      name: args.name,
      version: args.version,
      sessionId: extra?.sessionId,
    });

    try {
      // Delete composition (same logic as REST DELETE /v1/compositions/:name/:version)
      await this.compositionRegistry.delete(args.name, args.version);

      // Unregister from ToolRegistry
      this.registry.unregisterTool(args.name);

      logger.info('composition_admin.delete.success', {
        name: args.name,
        version: args.version,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Composition deleted: ${args.name} (version ${args.version})`,
                deleted: {
                  name: args.name,
                  version: args.version,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      logger.error('composition_admin.delete.error', {
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : 'Failed to delete composition'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle composition.stats tool invocation.
   * Returns composition registry statistics.
   * Sprint 41 (COMP-017A): MCP administrative tool.
   */
  private async handleCompositionStats(
    args: CompositionStatsArgs,
    extra?: { sessionId?: string; userRoles?: string[] }
  ): Promise<any> {
    const logger = this.getLogger();

    if (!this.compositionsEnabled || !this.compositionRegistry) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Composition subsystem not enabled (DocumentStore not available)',
          },
        ],
        isError: true,
      };
    }

    logger.debug('composition_admin.stats.start', {
      sessionId: extra?.sessionId,
    });

    try {
      // Get stats (same logic as REST GET /v1/compositions/stats)
      const stats = await this.compositionRegistry.getStats();

      logger.debug('composition_admin.stats.success', {
        totalCompositions: stats.totalCompositions,
        totalVersions: stats.totalVersions,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    } catch (err) {
      logger.error('composition_admin.stats.error', {
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : 'Failed to get composition statistics'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle composition.list_tools tool invocation.
   * Returns all available tools with CANONICAL IDs for use in compositions.
   * Sprint 41 (Information Gap Remediation): Helper tool for discovering tool IDs.
   */
  private async handleCompositionListTools(
    args: CompositionListToolsArgs,
    extra?: { sessionId?: string; userRoles?: string[] }
  ): Promise<any> {
    const logger = this.getLogger();

    logger.debug('composition_admin.list_tools.start', {
      filter: args.filter,
      limit: args.limit,
      sessionId: extra?.sessionId,
    });

    try {
      // Get all tools from registry (returns Record<string, BitBratTool>)
      const toolsRecord = this.registry.getTools();
      const allTools = Object.values(toolsRecord);

      // Filter tools if pattern provided
      let filtered = allTools;
      if (args.filter) {
        const pattern = args.filter.toLowerCase();
        filtered = allTools.filter(t =>
          t.id.toLowerCase().includes(pattern) ||
          (t.displayName && t.displayName.toLowerCase().includes(pattern)) ||
          (t.description && t.description.toLowerCase().includes(pattern))
        );
      }

      // Apply limit (default 100)
      const limit = args.limit || 100;
      const limited = filtered.slice(0, limit);

      // Format output - normalize tool IDs to canonical form
      const tools = limited.map(t => {
        // Strip MCP prefixes to get canonical ID
        let canonicalId = t.id;

        // Remove 'mcp_' prefix (e.g., 'mcp_get_state' -> 'get_state')
        if (canonicalId.startsWith('mcp_')) {
          canonicalId = canonicalId.slice(4);
        }

        // Remove 'mcp:' prefix and server name (e.g., 'mcp:generate_image' -> 'generate_image')
        // Also handles 'mcp:server-name/tool-name' -> 'tool-name'
        if (canonicalId.startsWith('mcp:')) {
          const withoutPrefix = canonicalId.slice(4); // Remove 'mcp:'
          const parts = withoutPrefix.split('/');
          canonicalId = parts[parts.length - 1]; // Get last part (tool name)
        }

        return {
          id: canonicalId,  // Canonical ID (no mcp_ or mcp: prefix)
          displayName: t.displayName || canonicalId,
          description: t.description || '',
          source: t.source || 'unknown',
          // Include simplified schema if available
          hasInputSchema: !!t.inputSchema,
        };
      });

      logger.debug('composition_admin.list_tools.success', {
        totalTools: allTools.length,
        filteredCount: filtered.length,
        returnedCount: tools.length,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              totalAvailable: allTools.length,
              filtered: filtered.length,
              returned: tools.length,
              tools,
              hint: 'Use these canonical tool IDs in composition steps (e.g., steps[].call)',
            }, null, 2),
          },
        ],
      };
    } catch (err) {
      logger.error('composition_admin.list_tools.error', {
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : 'Failed to list tools'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Load all compositions from DocumentStore and register them as tools
   * Sprint 41: Composition subsystem integration
   */
  private async loadCompositions(): Promise<void> {
    if (!this.compositionsEnabled || !this.compositionRegistry) {
      return;
    }

    try {
      const compositions = await this.compositionRegistry.list();
      this.getLogger().info('tool_gateway.compositions.loaded', {
        count: compositions.length,
        names: compositions.map((c) => c.name),
      });

      // Register each composition as an MCP tool (COMP-014)
      for (const record of compositions) {
        await this.registerCompositionTool(record.compiled);
      }

      this.getLogger().info('tool_gateway.compositions.registered', {
        count: compositions.length,
      });
    } catch (err) {
      this.getLogger().error('tool_gateway.compositions.load_failed', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Graceful degradation: Don't fail startup if compositions can't be loaded
    }
  }

  /**
   * Register a composition as an MCP tool
   * Sprint 41 (COMP-014): Each composition becomes a callable tool
   */
  private async registerCompositionTool(composition: any): Promise<void> {
    const toolId = composition.metadata.name;
    const description = composition.metadata.description || `Composition: ${toolId}`;

    try {
      // Register in ToolRegistry (used for internal tool resolution)
      this.registry.registerTool({
        id: toolId,
        displayName: toolId,
        description,
        inputSchema: composition.spec.inputSchema,
        source: 'composition',
        execute: async (args: unknown, extra?: any) => {
          return await this.executeComposition(composition, args, extra);
        },
      });

      // Register via Bit MCP interface (exposes to MCP clients)
      // LIMITATION (Sprint 42): MCP SDK 2.0 requires Zod schemas for inputSchema.
      // Compositions use JSON Schema, which requires conversion to Zod for proper LLM visibility.
      // Using z.any() for now - composition executor validates inputs internally using JSON Schema.
      // TODO (Future Sprint): Implement JSON Schema → Zod conversion for composition tools
      // so LLMs can see the expected parameters.
      this.registerTool(
        toolId,
        description,
        z.any(),  // Allows any input - validation happens in CompositionExecutor
        async (args: unknown, extra?: any) => {
          return await this.executeComposition(composition, args, extra);
        }
      );

      this.getLogger().debug('tool_gateway.composition.registered', {
        toolId,
        version: composition.metadata.version,
      });
    } catch (err) {
      this.getLogger().error('tool_gateway.composition.registration_failed', {
        toolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Execute a composition
   * Sprint 41 (COMP-014): Invokes CompositionExecutor with proper ExecutionContext
   */
  private async executeComposition(
    composition: any,
    args: unknown,
    extra?: { sessionId?: string; userRoles?: string[]; correlationId?: string }
  ): Promise<any> {
    if (!this.compositionExecutor) {
      throw new Error('Composition executor not initialized');
    }

    const logger = this.getLogger();
    const sessionId = extra?.sessionId || randomUUID();
    const correlationId = extra?.correlationId || randomUUID();

    logger.debug('tool_gateway.composition.execute', {
      composition: composition.metadata.name,
      version: composition.metadata.version,
      sessionId,
      correlationId,
    });

    try {
      // Build execution context
      const executionContext = {
        input: args,
        context: {}, // TODO: Could populate from session context if needed
        sessionId,
        correlationId,
        userRoles: extra?.userRoles || ['user'],
      };

      // Execute composition
      const result = await this.compositionExecutor.execute(composition, executionContext);

      if (result.status === 'success') {
        logger.info('tool_gateway.composition.execute.success', {
          composition: composition.metadata.name,
          sessionId,
          correlationId,
          executionTime: result.executionTime,
          stepsExecuted: result.stepsExecuted,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.output, null, 2),
            },
          ],
        };
      } else {
        logger.error('tool_gateway.composition.execute.failed', {
          composition: composition.metadata.name,
          sessionId,
          correlationId,
          error: result.error,
          errorCode: result.errorCode,
          executionTime: result.executionTime,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Composition execution failed: ${result.error}`,
            },
          ],
          isError: true,
        };
      }
    } catch (err) {
      logger.error('tool_gateway.composition.execute.exception', {
        composition: composition.metadata.name,
        sessionId,
        correlationId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Composition execution error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }

  async start(port: number) {
    // Load compositions from DocumentStore (Sprint 41)
    await this.loadCompositions();

    // Initialize Composition Watcher for hot-reloading (Sprint 42)
    if (this.compositionsEnabled && this.compositionRegistry) {
      const pollInterval = parseInt(
        process.env.COMPOSITION_POLL_INTERVAL_MS || '30000',
        10
      );

      this.compositionWatcher = new CompositionWatcher(this, {
        registry: this.compositionRegistry,
        onCompositionAdded: async (composition) => {
          this.getLogger().info('composition_watcher.registering_new', {
            name: composition.metadata.name,
            version: composition.metadata.version,
          });

          try {
            // Register the new composition as an MCP tool
            await this.registerCompositionTool(composition);

            // Broadcast tool list changed notification to all connected MCP clients
            try {
              await this.broadcastListChangedNotifications();
            } catch (notifyError: any) {
              this.getLogger().warn('composition_watcher.broadcast_failed', {
                name: composition.metadata.name,
                error: notifyError.message,
              });
            }
          } catch (error: any) {
            this.getLogger().error('composition_watcher.registration_failed', {
              name: composition.metadata.name,
              error: error.message,
              stack: error.stack,
            });
          }
        },
        onCompositionUpdated: async (composition) => {
          this.getLogger().info('composition_watcher.re_registering', {
            name: composition.metadata.name,
            version: composition.metadata.version,
          });

          try {
            // Re-register the composition (overwrites existing)
            await this.registerCompositionTool(composition);

            // Broadcast tool list changed notification
            try {
              await this.broadcastListChangedNotifications();
            } catch (notifyError: any) {
              this.getLogger().warn('composition_watcher.broadcast_failed', {
                name: composition.metadata.name,
                error: notifyError.message,
              });
            }
          } catch (error: any) {
            this.getLogger().error('composition_watcher.re_registration_failed', {
              name: composition.metadata.name,
              error: error.message,
              stack: error.stack,
            });
          }
        },
        onCompositionRemoved: async (name, version) => {
          this.getLogger().info('composition_watcher.unregistering', {
            name,
            version,
          });

          try {
            // Unregister from ToolRegistry
            this.registry.unregisterTool(name);

            // Note: Bit MCP server doesn't have unregisterTool yet
            // The tool will still appear in MCP listings until service restart
            // or until we implement dynamic tool unregistration

            // Broadcast tool list changed notification
            try {
              await this.broadcastListChangedNotifications();
            } catch (notifyError: any) {
              this.getLogger().warn('composition_watcher.broadcast_failed', {
                name,
                error: notifyError.message,
              });
            }
          } catch (error: any) {
            this.getLogger().error('composition_watcher.unregistration_failed', {
              name,
              error: error.message,
              stack: error.stack,
            });
          }
        },
        pollInterval,
      });

      this.compositionWatcher.start();
    }

    // Initialize MCP Registry Watcher to populate upstream tools
    this.registryWatcher = new RegistryWatcher(this as any, {
      store: this.mcpServerStore,
      onServerActive: async (config) => {
        try {
          this.serverConfigs.set(config.name, config);
          await this.mcpManager.connectServer(config);
          // After connecting to a new Bit and discovering its tools, notify all connected clients
          // that the tool/resource/prompt lists have changed. This ensures clients like llm-bot
          // refresh their tool registries without requiring manual restarts.
          // Sprint 27: MUST await async broadcastListChangedNotifications() to prevent
          // unhandled promise rejections that crash the process
          try {
            await this.broadcastListChangedNotifications();
          } catch (notifyError: any) {
            this.getLogger().warn('tool_gateway.registry_watcher.broadcast_failed', {
              name: config.name,
              error: notifyError.message,
              stack: notifyError.stack
            });
          }
        } catch (error: any) {
          this.getLogger().error('tool_gateway.registry_watcher.on_server_active_error', {
            name: config.name,
            error: error.message,
            stack: error.stack
          });
        }
      },
      onServerInactive: async (name) => {
        try {
          this.serverConfigs.delete(name);
          await this.mcpManager.disconnectServer(name);
          // Also notify when a server becomes inactive, as tool/resource/prompt lists have changed
          // Sprint 27: MUST await async broadcastListChangedNotifications() to prevent
          // unhandled promise rejections that crash the process
          try {
            await this.broadcastListChangedNotifications();
          } catch (notifyError: any) {
            this.getLogger().warn('tool_gateway.registry_watcher.broadcast_failed_inactive', {
              name,
              error: notifyError.message,
              stack: notifyError.stack
            });
          }
        } catch (error: any) {
          this.getLogger().error('tool_gateway.registry_watcher.on_server_inactive_error', {
            name,
            error: error.message,
            stack: error.stack
          });
        }
      },
    });
    this.registryWatcher.start();

    // Subscribe to auto-registration events (BL-314-03)
    await this.onMessage({
      destination: INTERNAL_MCP_REGISTRATION_V1,
      queue: 'tool-gateway'
    }, async (event: InternalEventV2) => {
      await this.handleMcpRegistration(event);
    });

    // Cleanup expired request deduplication entries every 60 seconds
    setInterval(() => {
      const now = Date.now();
      const expiredKeys: string[] = [];
      for (const [dedupKey, completedAt] of this.completedRequests.entries()) {
        if (now - completedAt > 60000) {
          expiredKeys.push(dedupKey);
        }
      }
      for (const key of expiredKeys) {
        this.completedRequests.delete(key);
        this.inFlightRequests.delete(key);
      }
      if (expiredKeys.length > 0) {
        this.getLogger().trace('tool_gateway.dedup.cleanup', { cleaned: expiredKeys.length, remaining: this.completedRequests.size });
      }
    }, 60000);

    return super.start(port);
  }

  /**
   * Handle incoming MCP registration events by upserting the server configuration
   * into Firestore. The RegistryWatcher will then automatically pick up the change
   * and establish/update the connection.
   */
  private async handleMcpRegistration(event: InternalEventV2) {
    const payload = event.payload;
    if (!payload || !payload.name || !payload.url) {
      this.getLogger().warn('tool_gateway.registration.invalid_payload', { 
        payload, 
        correlationId: event.correlationId 
      });
      return;
    }

    this.getLogger().info('tool_gateway.registration.received', { 
      name: payload.name, 
      url: payload.url,
      correlationId: event.correlationId 
    });

    // Capture any advertised context packs/bindings (additive field; absent on older Bits).
    const ctx = (payload as any).context;
    if (ctx && (Array.isArray(ctx.packs) || Array.isArray(ctx.bindings))) {
      this.contextProviders.set(payload.name, new StaticContextProvider(ctx.packs || [], ctx.bindings || []));
      this.getLogger().info('tool_gateway.context.advertised', {
        name: payload.name,
        packs: (ctx.packs || []).length,
        bindings: (ctx.bindings || []).length,
      });

      // P4 RAG Scale-Out: Persist context packs to Firestore for vector search (sprint-338, BL-338-201)
      if (Array.isArray(ctx.packs) && ctx.packs.length > 0) {
        await this.upsertContextPacks(payload.name, ctx.packs, event.correlationId);
      }
    }

    // Skip the Firestore write when the meaningful registration payload is unchanged from what we
    // last persisted. The per-event correlationId is excluded from the signature because it changes
    // on every heartbeat yet carries no configuration meaning. This prevents the write -> onSnapshot
    // -> reload churn that made the registry appear to be "continually reloading".
    const signature = this.registrationSignature(payload);
    if (this.registrationSignatures.get(payload.name) === signature) {
      this.getLogger().debug('tool_gateway.registration.skip_unchanged', {
        name: payload.name,
        correlationId: event.correlationId,
      });
      return;
    }

    // Set signature immediately for deduplication (synchronous)
    // This prevents duplicate writes even though the actual Firestore write is fire-and-forget
    this.registrationSignatures.set(payload.name, signature);

    // Fire-and-forget repository write with timeout to prevent blocking event handler
    const registrationWrite = (async () => {
      try {
        const doc: McpServerDocument = {
          name: payload.name,
          url: payload.url,
          ...payload,
          updatedAt: new Date().toISOString(),
          discoverySource: 'auto-registration',
          correlationId: event.correlationId
        };

        const writePromise = this.mcpServerStore.upsert(payload.name, doc);

        // Race against 5-second timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Store write timeout (5s)')), 5000)
        );

        await Promise.race([writePromise, timeoutPromise]);

        this.getLogger().info('tool_gateway.registration.upserted', {
          name: payload.name,
          correlationId: event.correlationId
        });
      } catch (error: any) {
        // On write failure, clear signature so retry can happen
        this.registrationSignatures.delete(payload.name);

        this.getLogger().error('tool_gateway.registration.upsert_failed', {
          name: payload.name,
          error: error?.message || String(error),
          correlationId: event.correlationId
        });
      }
    })();

    // Don't await - let it complete in background
    registrationWrite.catch(() => {});  // Suppress unhandled rejection warnings
  }

  /**
   * Upsert context packs to Firestore context_packs collection for vector search (P4 RAG Scale-Out).
   * Each pack is persisted with all its fields plus bitName, active flag, and embedding (BL-338-201/202).
   *
   * @param bitName - The name of the Bit advertising these packs
   * @param packs - Array of context packs to upsert
   * @param correlationId - Correlation ID from the registration event
   */
  private async upsertContextPacks(
    bitName: string,
    packs: any[],
    correlationId: string
  ): Promise<void> {
    const updatedAt = new Date().toISOString();

    for (const pack of packs) {
      try {
        // Build pack document with all fields + metadata
        const packDoc: ContextPackDocument = {
          id: pack.id,
          version: pack.version,
          title: pack.title,
          priority: pack.priority,
          format: pack.format,
          body: pack.body,
          source: pack.source,
          bitName,
          active: true,
          updatedAt,
        };

        // Generate embedding for this pack (BL-338-202)
        let embeddingGenerated = false;
        const embeddingText = buildEmbeddingText(pack);
        const embedding = await embedText(embeddingText);

        if (embedding) {
          packDoc.embedding = embedding;
          packDoc.embeddingText = embeddingText;
          embeddingGenerated = true;
        } else {
          // OpenAI API failure: log warning and persist pack without embedding
          // (will retry on next registration heartbeat)
          this.getLogger().warn('tool_gateway.context.embedding_failed', {
            packId: pack.id,
            bitName,
            correlationId,
          });
        }

        // Fire-and-forget repository write with timeout to prevent blocking
        const writePromise = (async () => {
          try {
            const upsertPromise = this.contextPackStore.upsert(pack.id, packDoc);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Store write timeout (5s)')), 5000)
            );
            await Promise.race([upsertPromise, timeoutPromise]);

            this.getLogger().info('tool_gateway.context.pack_registered', {
              packId: pack.id,
              bitName,
              embeddingGenerated,
              correlationId,
            });
          } catch (writeError: any) {
            this.getLogger().error('tool_gateway.context.pack_write_failed', {
              packId: pack.id,
              bitName,
              error: writeError?.message || String(writeError),
              correlationId,
            });
          }
        })();

        // Don't await - let it complete in background
        writePromise.catch(() => {});
      } catch (error: any) {
        // Firestore write failure is non-fatal for registration (log and continue)
        this.getLogger().error('tool_gateway.context.pack_upsert_failed', {
          packId: pack.id,
          bitName,
          error: error.message,
          correlationId,
        });
      }
    }
  }

  /**
   * Build a stable signature over the connection-meaningful fields of a registration payload so we can
   * detect heartbeat re-registrations that carry no change. The per-event `correlationId` is excluded
   * because it varies on every publish yet has no configuration meaning; the metadata we add ourselves
   * on write (`updatedAt`, `discoverySource`) is likewise not part of the payload. Keys are sorted so
   * the signature is independent of property ordering.
   */
  private registrationSignature(payload: any): string {
    const { correlationId, updatedAt, discoverySource, ...meaningful } = payload || {};
    const stable = (value: any): any => {
      if (Array.isArray(value)) return value.map(stable);
      if (value && typeof value === 'object') {
        return Object.keys(value)
          .sort()
          .reduce((acc: Record<string, any>, key) => {
            acc[key] = stable(value[key]);
            return acc;
          }, {});
      }
      return value;
    };
    return JSON.stringify(stable(meaningful));
  }

  async close(reason?: string) {
    if (this.registryWatcher) this.registryWatcher.stop();
    if (this.compositionWatcher) this.compositionWatcher.stop();
    await this.mcpManager.shutdown();
    // Clear all tracked session servers and contexts
    this.sessionServers.clear();
    this.sessionContexts.clear();
    return super.close(reason);
  }

  /**
   * Broadcast tool/resource/prompt list change notifications to all connected MCP clients.
   * Called when new Bits register and their tools are discovered, or when Bits become inactive.
   * This enables clients (like llm-bot) to refresh their tool registries without manual restarts,
   * solving the startup race condition where clients connect before tool-gateway has discovered
   * all Bits.
   */
  private async broadcastListChangedNotifications(): Promise<void> {
    const logger = this.getLogger();
    const sessionCount = this.sessionServers.size;

    if (sessionCount === 0) {
      logger.debug('tool_gateway.notifications.no_sessions', {
        message: 'No active sessions to notify'
      });
      return;
    }

    logger.info('tool_gateway.notifications.broadcasting', {
      sessionCount,
      types: ['tools', 'resources', 'prompts']
    });

    let successCount = 0;
    let errorCount = 0;

    // Convert to array to avoid modification-during-iteration issues
    const sessions = Array.from(this.sessionServers.entries());

    // Sprint 27: Use Promise.allSettled to handle async notifications safely
    // notification() is async and throws synchronously before async machinery,
    // causing unhandled promise rejections if not awaited
    const notificationPromises = sessions.map(async ([sessionId, server]) => {
      try {
        // Send all three notifications concurrently for this session
        await Promise.allSettled([
          server.notification({
            method: 'notifications/tools/list_changed',
            params: {}
          }),
          server.notification({
            method: 'notifications/resources/list_changed',
            params: {}
          }),
          server.notification({
            method: 'notifications/prompts/list_changed',
            params: {}
          })
        ]);

        successCount++;
        logger.debug('tool_gateway.notifications.sent', { sessionId });
      } catch (error: any) {
        errorCount++;

        // If session is disconnected, remove it from both maps
        if (error.message === 'Not connected') {
          this.sessionServers.delete(sessionId);
          this.sessionContexts.delete(sessionId);
          logger.debug('tool_gateway.notifications.session_cleaned', {
            sessionId,
            reason: 'disconnected'
          });
        } else {
          // Log unexpected errors differently
          logger.warn('tool_gateway.notifications.send_failed', {
            sessionId,
            error: error.message,
            stack: error.stack
          });
        }
      }
    });

    // Wait for all notification attempts to complete
    await Promise.allSettled(notificationPromises);

    logger.info('tool_gateway.notifications.broadcast_complete', {
      sessionCount,
      successCount,
      errorCount
    });
  }

  /**
   * Just-in-Time Context Provisioning (sprint-328 P2, sprint-338 P4): resolve the Context Packs
   * bound to the active tool set across all registered Bits, de-duplicated by pack id, and render
   * them as prompt-assembly NamedContexts. Tool names may be bare ("create_schedule") or
   * discovery-qualified ("mcp:create_schedule"); the leading "mcp:" prefix is stripped.
   * P4: Made async to support VectorContextProvider (RAG retrieval via Firestore Vector Search).
   * P4: Added semanticQuery parameter for RAG-based context augmentation.
   * With no bound packs this returns [] so the assembled prompt is unchanged vs. today (behavior-preserving).
   *
   * @param toolNames - Tool names to resolve context for (strips 'mcp:' prefix if present)
   * @param extra - Optional extra context (tasks, eventTypes)
   * @param semanticQuery - Optional semantic query for RAG-based context retrieval (e.g., user prompt)
   * @returns Array of named context objects for prompt injection
   */
  public async resolveContextForTools(
    toolNames: string[],
    extra?: Partial<ContextActiveSet>,
    semanticQuery?: string
  ): Promise<NamedContext[]> {
    const tools = (toolNames || []).map((n) => (n.startsWith('mcp:') ? n.slice(4) : n));
    const active: ContextActiveSet = { tools, tasks: extra?.tasks, eventTypes: extra?.eventTypes };

    // Path 1: Static resolution (P2 logic, existing providers)
    const staticProviders = Array.from(this.contextProviders.values());
    const staticPacks = await resolveContextPacks(active, staticProviders, {
      onWarn: (message, meta) => this.getLogger().warn(message, meta),
    });

    // Collect static pack IDs for de-duplication
    const staticPackIds = new Set(staticPacks.map((p) => p.id));

    // Path 2: RAG augmentation (if enabled and semanticQuery provided)
    let ragPacks: ContextPack[] = [];
    if (this.isRagContextEnabled() && semanticQuery && tools.length > 0) {
      const startMs = Date.now();
      try {
        const { VectorContextProvider } = await import('../common/context/vector-provider');
        const maxResults = parseInt(this.getConfig('RAG_CONTEXT_MAX_RESULTS', { default: '5' }), 10);
        const minSimilarity = parseFloat(this.getConfig('RAG_CONTEXT_MIN_SIMILARITY', { default: '0.7' }));
        const timeout = parseInt(this.getConfig('RAG_CONTEXT_TIMEOUT_MS', { default: '200' }), 10);

        const vectorProvider = new VectorContextProvider(semanticQuery, {
          maxResults,
          minSimilarity,
          timeout,
        });

        const vectorPacks = await vectorProvider.listPacks();

        // De-duplicate: filter out packs already in static results (static takes precedence)
        ragPacks = vectorPacks.filter((p) => !staticPackIds.has(p.id));

        const latencyMs = Date.now() - startMs;
        this.getLogger().info('tool_gateway.context.rag_augmented', {
          staticCount: staticPacks.length,
          ragCount: ragPacks.length,
          querySnippet: semanticQuery.slice(0, 50),
          latencyMs,
        });
      } catch (err) {
        const latencyMs = Date.now() - startMs;
        this.getLogger().warn('tool_gateway.context.rag_failed', {
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
          querySnippet: semanticQuery.slice(0, 50),
        });
        // Non-fatal: continue with static packs only
      }
    }

    // Merge static + RAG packs (static first, RAG appended)
    const allPacks = [...staticPacks, ...ragPacks];
    return packsToNamedContexts(allPacks);
  }

  /**
   * Check if RAG context augmentation is enabled via feature flag.
   */
  private isRagContextEnabled(): boolean {
    try {
      return this.getConfig('RAG_CONTEXT_ENABLED', { default: 'false' }).toLowerCase() === 'true';
    } catch {
      return false;
    }
  }

  private setupApp(app: Express) {
    // Health endpoint
    this.onHTTPRequest('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', service: SERVICE_NAME, ts: new Date().toISOString() });
    });

    // REST: GET /v1/tools
    this.onHTTPRequest('/v1/tools', (req: Request, res: Response) => {
      const context = this.extractSessionContext(req);
      const tools = Object.values(this.registry.getTools())
        .filter((t) => {
          // Sprint 42: Compositions available to all roles/agents (full RBAC scoped for later)
          if (t.source === 'composition') return true;
          return this.rbac.isAllowedTool(t, t.originServer ? this.serverConfigs.get(t.originServer) : undefined, context);
        })
        .map((t) => ({
          id: t.id,
          name: t.displayName || t.id,
          description: t.description,
          inputSchema: (t as any).inputSchema?.jsonSchema || {},
        }));
      res.json({ tools });
    });

    // REST: POST /v1/tools/:id
    this.onHTTPRequest({ path: '/v1/tools/:id', method: 'POST' }, async (req: Request, res: Response) => {
      const toolId = req.params.id;
      const context = this.extractSessionContext(req);

      // Try direct lookup first (by original ID), then by sanitized name
      let tool = this.registry.getTool(toolId);
      if (!tool) {
        this.getLogger().debug('tool_gateway.rest.tool_not_found_by_id', { toolId, attemptingSanitizedLookup: true });
        tool = this.registry.getToolBySanitizedName(toolId);
        if (tool) {
          this.getLogger().debug('tool_gateway.rest.tool_found_by_sanitized_name', {
            toolId,
            actualToolId: tool.id,
            displayName: tool.displayName
          });
        }
      }

      if (!tool) {
        // List available tools for debugging
        const availableTools = Object.keys(this.registry.getTools());
        this.getLogger().warn('tool_gateway.rest.tool_not_found', {
          requestedTool: toolId,
          availableToolCount: availableTools.length,
          sampleTools: availableTools.slice(0, 10)
        });
        return res.status(404).json({ error: 'Tool not found' });
      }
      
      const allowed = this.rbac.isAllowedTool(tool, tool.originServer ? this.serverConfigs.get(tool.originServer) : undefined, context);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });

      const start = Date.now();
      try {
        const args = req.body.args || req.body.arguments || req.body;
        this.getLogger().debug('tool_gateway.rest.call_tool.start', { toolId, args, context });
        const result = await tool.execute?.(args as any, { 
          userRoles: context.roles,
          userId: context.userId,
          agentName: context.agentName
        });
        const duration = Date.now() - start;
        this.getLogger().debug('tool_gateway.rest.call_tool.success', { toolId, duration });
        res.json({ result });
      } catch (error: any) {
        const duration = Date.now() - start;
        this.getLogger().error('tool_gateway.rest.call_tool.error', { toolId, error: error.message, duration });
        res.status(500).json({ error: error.message });
      }
    });

    // REST: GET /v1/resources
    this.onHTTPRequest('/v1/resources', (req: Request, res: Response) => {
      const uri = req.query.uri as string;
      const context = this.extractSessionContext(req);

      if (uri) {
        const resource = this.registry.getResource(uri);
        if (!resource) return res.status(404).json({ error: 'Resource not found' });
        
        const allowed = this.rbac.isAllowedResource(resource, resource.originServer ? this.serverConfigs.get(resource.originServer) : undefined, context);
        if (!allowed) return res.status(403).json({ error: 'Forbidden' });

        this.getLogger().debug('tool_gateway.rest.read_resource.start', { uri, context });
        const start = Date.now();

        if (!resource.read) {
          return res.status(500).json({ error: 'Resource does not support read operation' });
        }

        resource.read({
          userRoles: context.roles,
          userId: context.userId,
          agentName: context.agentName
        }).then(result => {
          const duration = Date.now() - start;
          this.getLogger().debug('tool_gateway.rest.read_resource.success', { uri, duration });
          res.json({ result });
        }).catch(e => {
          const duration = Date.now() - start;
          this.getLogger().error('tool_gateway.rest.read_resource.error', { uri, error: e.message, duration });
          res.status(500).json({ error: e.message });
        });
      } else {
        const resources = Object.values(this.registry.getResources())
          .filter(r => this.rbac.isAllowedResource(r, r.originServer ? this.serverConfigs.get(r.originServer) : undefined, context))
          .map(r => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType
          }));
        res.json({ resources });
      }
    });

    // ========================================================================
    // Composition Management REST API (Sprint 41 - COMP-015)
    // ========================================================================

    // POST /v1/compositions - Register a new composition
    this.onHTTPRequest({ path: '/v1/compositions', method: 'POST' }, async (req: Request, res: Response) => {
      if (!this.compositionsEnabled || !this.compositionRegistry) {
        return res.status(503).json({ error: 'Composition subsystem not enabled' });
      }

      const context = this.extractSessionContext(req);
      this.getLogger().debug('composition_api.register.start', { context });

      try {
        const definition = req.body;
        const compiled = await this.compositionRegistry.register(definition);

        // Register as MCP tool
        await this.registerCompositionTool(compiled);

        this.getLogger().info('composition_api.register.success', {
          name: compiled.metadata.name,
          version: compiled.metadata.version,
          id: compiled.id,
        });

        res.status(201).json({
          id: compiled.id,
          name: compiled.metadata.name,
          version: compiled.metadata.version,
          contentHash: compiled.contentHash,
        });
      } catch (err) {
        this.getLogger().error('composition_api.register.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to register composition',
        });
      }
    });

    // GET /v1/compositions - List all compositions
    this.onHTTPRequest('/v1/compositions', async (req: Request, res: Response) => {
      if (!this.compositionsEnabled || !this.compositionRegistry) {
        return res.status(503).json({ error: 'Composition subsystem not enabled' });
      }

      try {
        const compositions = await this.compositionRegistry.list();

        res.json({
          compositions: compositions.map((c) => ({
            id: c.id,
            name: c.name,
            version: c.version,
            contentHash: c.contentHash,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          })),
        });
      } catch (err) {
        this.getLogger().error('composition_api.list.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: 'Failed to list compositions',
        });
      }
    });

    // GET /v1/compositions/stats - Get registry statistics
    this.onHTTPRequest('/v1/compositions/stats', async (req: Request, res: Response) => {
      if (!this.compositionsEnabled || !this.compositionRegistry) {
        return res.status(503).json({ error: 'Composition subsystem not enabled' });
      }

      try {
        const stats = await this.compositionRegistry.getStats();
        res.json(stats);
      } catch (err) {
        this.getLogger().error('composition_api.stats.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: 'Failed to get composition statistics',
        });
      }
    });

    // GET /v1/compositions/:name/:version - Get specific composition version
    this.onHTTPRequest('/v1/compositions/:name/:version', async (req: Request, res: Response) => {
      if (!this.compositionsEnabled || !this.compositionRegistry) {
        return res.status(503).json({ error: 'Composition subsystem not enabled' });
      }

      try {
        const { name, version } = req.params;
        const versionNum = parseInt(version, 10);

        if (isNaN(versionNum)) {
          return res.status(400).json({ error: 'Version must be a number' });
        }

        const composition = await this.compositionRegistry.get(name, versionNum);

        if (!composition) {
          return res.status(404).json({ error: 'Composition not found' });
        }

        res.json(composition);
      } catch (err) {
        this.getLogger().error('composition_api.get.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: 'Failed to retrieve composition',
        });
      }
    });

    // GET /v1/compositions/:name - Get latest version of composition
    this.onHTTPRequest('/v1/compositions/:name', async (req: Request, res: Response) => {
      if (!this.compositionsEnabled || !this.compositionRegistry) {
        return res.status(503).json({ error: 'Composition subsystem not enabled' });
      }

      try {
        const { name } = req.params;
        const composition = await this.compositionRegistry.get(name);

        if (!composition) {
          return res.status(404).json({ error: 'Composition not found' });
        }

        res.json(composition);
      } catch (err) {
        this.getLogger().error('composition_api.get_latest.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: 'Failed to retrieve composition',
        });
      }
    });

    // DELETE /v1/compositions/:name/:version - Delete specific composition version
    this.onHTTPRequest({ path: '/v1/compositions/:name/:version', method: 'DELETE' }, async (req: Request, res: Response) => {
      if (!this.compositionsEnabled || !this.compositionRegistry) {
        return res.status(503).json({ error: 'Composition subsystem not enabled' });
      }

      const context = this.extractSessionContext(req);
      this.getLogger().debug('composition_api.delete.start', { context });

      try {
        const { name, version } = req.params;
        const versionNum = parseInt(version, 10);

        if (isNaN(versionNum)) {
          return res.status(400).json({ error: 'Version must be a number' });
        }

        await this.compositionRegistry.delete(name, versionNum);

        // Unregister from ToolRegistry
        this.registry.unregisterTool(name);

        this.getLogger().info('composition_api.delete.success', {
          name,
          version: versionNum,
        });

        res.status(204).send();
      } catch (err) {
        this.getLogger().error('composition_api.delete.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to delete composition',
        });
      }
    });

    // MCP SSE endpoints are registered by McpServer constructor (/sse and /message)
  }

  protected async getMcpServerForConnection(req: Request): Promise<Server> {
    const context = this.extractSessionContext(req);

    const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
    const svcNode = arch?.services?.[SERVICE_NAME] || {};
    const description = svcNode.description || 'BitBrat Tool Gateway (session)';
    const version = arch?.project?.version || '1.0.0';

    const logger = this.getLogger();

    // Generate unique session ID for tracking this connection
    const sessionId = `${context.agentName || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const sessionServer = new Server(
      {
        name: `${SERVICE_NAME}-session`,
        version,
        description,
      } as any,
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // Track this session server for broadcasting notifications
    this.sessionServers.set(sessionId, sessionServer);

    // Track session context for platform tools (Sprint 22: agent.sendProgressUpdate)
    // currentEvent will be populated by llm-bot or other agents when they invoke tools
    this.sessionContexts.set(sessionId, {
      ...context,
      sessionId,
      currentEvent: undefined, // Will be set when agent provides event context
    });

    logger.info('tool_gateway.session.registered', {
      sessionId,
      agentName: context.agentName,
      totalSessions: this.sessionServers.size,
      totalContexts: this.sessionContexts.size
    });

    // Discovery: listTools filtered by RBAC
    sessionServer.setRequestHandler('tools/list', async (request, ctx) => {
      logger.trace('Handling ListToolsRequestSchema', {headers: ctx.http?.req?.headers});
      const trustedDiscovery = (context.agentName === 'llm-bot') || (Array.isArray(context.roles) && context.roles.includes('discovery'));
      const rawTools = Object.values(this.registry.getTools());
      const visibleTools = trustedDiscovery
        ? rawTools
        : rawTools.filter((t) => {
            // Sprint 42: Compositions available to all roles/agents (full RBAC scoped for later)
            if (t.source === 'composition') return true;
            return this.rbac.isAllowedTool(t, t.originServer ? this.serverConfigs.get(t.originServer) : undefined, context);
          });
      const tools = visibleTools.map((t) => {
          const s: any = (t as any).inputSchema;
          let inputSchema: any = { type: 'object' };
          if (s && typeof s === 'object' && 'jsonSchema' in s) {
            inputSchema = s.jsonSchema;
          } else if (s && typeof (s as any).safeParse === 'function') {
            try {
              const { zodToJsonSchema } = require('zod-to-json-schema');
              const j = zodToJsonSchema(s, 'input');
              // Prefer a concrete object schema at the top level
              if (j && typeof j === 'object' && j.type === 'object') {
                inputSchema = j;
              } else if (j && typeof j === 'object') {
                const defs = (j as any).definitions || (j as any).$defs;
                if (defs && defs.input) {
                  inputSchema = defs.input;
                } else {
                  inputSchema = { type: 'object' };
                }
              } else {
                inputSchema = { type: 'object' };
              }
            } catch {
              inputSchema = { type: 'object' };
            }
          }
          return ({
            name: t.id,
            description: t.description,
            inputSchema,
            scopes: t.scopes,
          });
        });
      logger.trace(`Returning ${tools.length} tools (trustedDiscovery=${trustedDiscovery})`);
      return { tools } as any;
    });

    // Discovery: listResources filtered by RBAC
    sessionServer.setRequestHandler('resources/list', async () => {
      const trustedDiscovery = (context.agentName === 'llm-bot') || (Array.isArray(context.roles) && context.roles.includes('discovery'));
      const raw = Object.values(this.registry.getResources());
      const visible = trustedDiscovery
        ? raw
        : raw.filter((r) => this.rbac.isAllowedResource(r, r.originServer ? this.serverConfigs.get(r.originServer) : undefined, context));
      const resources = visible.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
      return { resources } as any;
    });

    // Discovery: listPrompts filtered by RBAC
    sessionServer.setRequestHandler('prompts/list', async () => {
      const trustedDiscovery = (context.agentName === 'llm-bot') || (Array.isArray(context.roles) && context.roles.includes('discovery'));
      const raw = Object.values(this.registry.getPrompts());
      const visible = trustedDiscovery
        ? raw
        : raw.filter((p) => this.rbac.isAllowedPrompt(p, p.originServer ? this.serverConfigs.get(p.originServer) : undefined, context));
      const prompts = visible.map((p) => ({
          name: p.id,
          description: p.description,
          arguments: p.arguments,
        }));
      return { prompts } as any;
    });

    // Invocation: callTool
    sessionServer.setRequestHandler('tools/call', async (request, ctx) => {
      // Request deduplication: The MCP SDK invokes this handler multiple times for the SAME request
      // CRITICAL BUG: The MCP SDK assigns DIFFERENT jsonRpcIds to duplicate invocations of the same
      // client request (e.g., jsonRpcId 13, 14, 15... for the same search query). This means we
      // CANNOT use requestId for deduplication. Instead, we dedupe by tool + args hash only.
      // This is safe because:
      // 1. Tool executions are idempotent (same args = same result)
      // 2. Dedup keys are cleared after 60s, so repeated legitimate calls still work
      // 3. The alternative (no dedup) causes thousands of duplicate executions
      const toolName = request.params.name;
      const args = request.params.arguments || {};

      // Create deduplication key from tool + args hash ONLY (not requestId)
      const argsHash = JSON.stringify(args);
      const dedupKey = `${toolName}:${argsHash}`;

      // Check if this exact request is already being processed
      let executionPromise = this.inFlightRequests.get(dedupKey);

      if (executionPromise) {
        // This request is already being executed - await the same Promise
        logger.trace('tool_gateway.mcp.call_tool.duplicate_awaiting', {
          toolName,
          dedupKey: dedupKey.substring(0, 100)
        });
        return await executionPromise;
      }

      // This is the first invocation - create the execution Promise
      const id = request.params.name;
      const tool = this.registry.getTool(id);
      if (!tool) throw new Error(`Tool not found: ${id}`);

      // Extract dynamic request context (roles/user)
      /* @mcp-codemod-error The context object is forwarded to this.getRequestContext(…) — its property shape changed in v2 (e.g. extra.signal is now ctx.mcpReq.signal, extra.sendRequest is ctx.mcpReq.send). Update the helper's parameter type and property accesses. */
      const reqContext = this.getRequestContext(request, ctx, context);

      // Defense-in-depth RBAC check at invocation time using request-level context
      const allowed = this.rbac.isAllowedTool(tool, tool.originServer ? this.serverConfigs.get(tool.originServer) : undefined, reqContext);
      if (!allowed) throw new Error('Forbidden');

      logger.trace('tool_gateway.mcp.call_tool.start', { id, args, reqContext });
      const start = Date.now();

      // Create execution Promise and store it
      executionPromise = (async () => {
        try {
          const result = await tool.execute?.(args as any, {
            sessionId,  // Sprint 22: Pass sessionId for platform-internal tools
            userRoles: reqContext.roles,
            userId: reqContext.userId,
            agentName: reqContext.agentName
          });
          const duration = Date.now() - start;
          logger.trace('tool_gateway.mcp.call_tool.success', { id, duration });

          // Translate result to MCP CallToolResult-like content
          if (typeof result === 'string') {
            return { content: [{ type: 'text', text: result }] } as any;
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] } as any;
        } catch (error: any) {
          const duration = Date.now() - start;
          // Normalize error to prevent recursive "MCP error -32603: MCP error -32603: ..." in logs
          const normalized = normalizeError(error);
          logger.error('tool_gateway.mcp.call_tool.error', { id, error: normalized.message, duration });
          throw error;
        } finally {
          // Remove from in-flight and mark as completed immediately
          // This prevents duplicate error logging when thousands of awaiting handlers
          // all receive the same rejection simultaneously
          this.inFlightRequests.delete(dedupKey);
          this.completedRequests.set(dedupKey, Date.now());
        }
      })();

      this.inFlightRequests.set(dedupKey, executionPromise);

      try {
        return await executionPromise;
      } catch (error) {
        // Don't log here - already logged in the executionPromise catch block above
        throw error;
      }
    });

    // Invocation: readResource
    sessionServer.setRequestHandler('resources/read', async (request, ctx) => {
      const uri = request.params.uri;
      const resource = this.registry.getResource(uri);
      if (!resource) throw new Error(`Resource not found: ${uri}`);

      /* @mcp-codemod-error The context object is forwarded to this.getRequestContext(…) — its property shape changed in v2 (e.g. extra.signal is now ctx.mcpReq.signal, extra.sendRequest is ctx.mcpReq.send). Update the helper's parameter type and property accesses. */
      const reqContext = this.getRequestContext(request, ctx, context);

      const allowed = this.rbac.isAllowedResource(resource, resource.originServer ? this.serverConfigs.get(resource.originServer) : undefined, reqContext);
      if (!allowed) throw new Error('Forbidden');

      logger.trace('tool_gateway.mcp.read_resource.start', { uri, reqContext });
      const start = Date.now();
      try {
        const result = await resource.read?.({
          userRoles: reqContext.roles,
          userId: reqContext.userId,
          agentName: reqContext.agentName
        });
        const duration = Date.now() - start;
        logger.trace('tool_gateway.mcp.read_resource.success', { uri, duration });
        return result as any;
      } catch (error: any) {
        const duration = Date.now() - start;
        logger.error('tool_gateway.mcp.read_resource.error', { uri, error: error.message, duration });
        throw error;
      }
    });

    // Invocation: getPrompt
    sessionServer.setRequestHandler('prompts/get', async (request, ctx) => {
      const id = request.params.name;
      const prompt = this.registry.getPrompt(id);
      if (!prompt) throw new Error(`Prompt not found: ${id}`);

      /* @mcp-codemod-error The context object is forwarded to this.getRequestContext(…) — its property shape changed in v2 (e.g. extra.signal is now ctx.mcpReq.signal, extra.sendRequest is ctx.mcpReq.send). Update the helper's parameter type and property accesses. */
      const reqContext = this.getRequestContext(request, ctx, context);

      const allowed = this.rbac.isAllowedPrompt(prompt, prompt.originServer ? this.serverConfigs.get(prompt.originServer) : undefined, reqContext);
      if (!allowed) throw new Error('Forbidden');

      const args = (request.params.arguments as Record<string, string>) || {};
      logger.trace('tool_gateway.mcp.get_prompt.start', { id, args, reqContext });
      const start = Date.now();
      try {
        const result = await prompt.get?.(args, {
          userRoles: reqContext.roles,
          userId: reqContext.userId,
          agentName: reqContext.agentName
        });
        const duration = Date.now() - start;
        logger.trace('tool_gateway.mcp.get_prompt.success', { id, duration });
        return result as any;
      } catch (error: any) {
        const duration = Date.now() - start;
        logger.error('tool_gateway.mcp.get_prompt.error', { id, error: error.message, duration });
        throw error;
      }
    });

    // Set up cleanup when the connection closes
    // The MCP Server SDK doesn't expose a direct onClose event, but the transport will close
    // when the client disconnects. We rely on the connection lifecycle managed by the base Bit class.
    // Sessions are also cleaned up periodically to handle stale connections (see cleanup timer in start()).
    // For immediate cleanup, we'd need to hook into the transport's close event, but that's not
    // easily accessible from here. The periodic cleanup is sufficient for our use case.

    return sessionServer;
  }

  /**
   * getRequestContext
   * Merges session-level context with per-request metadata (_meta) or headers.
   */
  private getRequestContext(request: any, extra: any, sessionContext: SessionContext): SessionContext {
    const headers = extra?.requestInfo?.headers;
    const meta = (request as any).params?._meta;

    const context = { ...sessionContext };

    // 1. Extract from headers (if provided via SSE POST /message)
    if (headers) {
      if (headers['x-roles']) {
        context.roles = headers['x-roles'].toString().split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
      }
      if (headers['x-user-id']) {
        context.userId = headers['x-user-id'].toString();
      }
    }

    // 2. Extract from MCP _meta (Preferred standard way)
    if (meta) {
      if (Array.isArray(meta.userRoles)) {
        context.roles = meta.userRoles;
      } else if (typeof meta.userRoles === 'string') {
        context.roles = meta.userRoles.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
      }
      
      if (meta.userId) {
        context.userId = meta.userId;
      }
    }

    return context;
  }

  private extractSessionContext(req: Request): SessionContext {
    const auth = (req.headers['authorization'] || '').toString();
    const agentName = (req.headers['x-agent-name'] || '').toString();
    const userId = (req.headers['x-user-id'] || '').toString() || undefined;
    const roles = this.parseRolesFromAuth(auth, req.headers['x-roles']);
    return { roles, agentName, userId };
  }

  private parseRolesFromAuth(authHeader: string, rolesHeader: any): string[] {
    // Prefer JWT roles if present
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (bearer && bearer.split('.').length >= 2) {
      try {
        const payloadB64 = bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
        const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        if (Array.isArray(json.roles)) return json.roles;
        if (Array.isArray(json?.realm_access?.roles)) return json.realm_access.roles;
        if (typeof json.scope === 'string') return json.scope.split(/[\s,]+/).filter(Boolean);
      } catch {
        // ignore decode errors
      }
    }
    // Fallback to x-roles header (csv or space-separated)
    if (rolesHeader) {
      const raw = rolesHeader.toString();
      return raw.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
    }
    return [];
  }
}

export function createServer() {
  return new ToolGatewayServer();
}

export function createApp() {
  const server = createServer();
  return server.getApp();
}

if (require.main === module) {
  const server = new ToolGatewayServer();
  void server.start(PORT);
}
