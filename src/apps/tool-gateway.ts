import { Bit } from '../common/base-server';
import { getFirestore } from '../common/firebase';
import { INTERNAL_MCP_REGISTRATION_V1, InternalEventV2 } from '../types/events';
import { Express, Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from '../services/llm-bot/tools/registry';
import { McpClientManager } from '../common/mcp/client-manager';
import { RegistryWatcher } from '../common/mcp/registry-watcher';
import { RbacEvaluator } from '../common/mcp/rbac';
import { McpServerConfig, SessionContext } from '../common/mcp/types';
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

const SERVICE_NAME = process.env.SERVICE_NAME || 'tool-gateway';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

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

  constructor() {
    super({ serviceName: SERVICE_NAME, mcpExposure: 'platform+domain' });
    this.setupApp(this.getApp() as any);
  }

  async start(port: number) {
    // Initialize MCP Registry Watcher to populate upstream tools
    this.registryWatcher = new RegistryWatcher(this as any, {
      onServerActive: async (config) => {
        this.serverConfigs.set(config.name, config);
        await this.mcpManager.connectServer(config);
        // After connecting to a new Bit and discovering its tools, notify all connected clients
        // that the tool/resource/prompt lists have changed. This ensures clients like llm-bot
        // refresh their tool registries without requiring manual restarts.
        this.broadcastListChangedNotifications();
      },
      onServerInactive: async (name) => {
        this.serverConfigs.delete(name);
        await this.mcpManager.disconnectServer(name);
        // Also notify when a server becomes inactive, as tool/resource/prompt lists have changed
        this.broadcastListChangedNotifications();
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

    // Fire-and-forget Firestore write with timeout to prevent blocking event handler
    const firestoreWrite = (async () => {
      try {
        const db = getFirestore();
        const writePromise = db.collection('mcp_servers').doc(payload.name).set({
          ...payload,
          updatedAt: new Date().toISOString(),
          discoverySource: 'auto-registration',
          correlationId: event.correlationId
        }, { merge: true });

        // Race against 5-second timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Firestore write timeout (5s)')), 5000)
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
    firestoreWrite.catch(() => {});  // Suppress unhandled rejection warnings
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
    const db = getFirestore();
    const updatedAt = new Date().toISOString();

    for (const pack of packs) {
      try {
        // Build pack document with all fields + metadata
        const packDoc: any = {
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

        // Fire-and-forget Firestore write with timeout to prevent blocking
        const writePromise = (async () => {
          try {
            const setPromise = db.collection('context_packs').doc(pack.id).set(packDoc, { merge: true });
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Firestore write timeout (5s)')), 5000)
            );
            await Promise.race([setPromise, timeoutPromise]);

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
    await this.mcpManager.shutdown();
    // Clear all tracked session servers
    this.sessionServers.clear();
    return super.close(reason);
  }

  /**
   * Broadcast tool/resource/prompt list change notifications to all connected MCP clients.
   * Called when new Bits register and their tools are discovered, or when Bits become inactive.
   * This enables clients (like llm-bot) to refresh their tool registries without manual restarts,
   * solving the startup race condition where clients connect before tool-gateway has discovered
   * all Bits.
   */
  private broadcastListChangedNotifications(): void {
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

    for (const [sessionId, server] of this.sessionServers.entries()) {
      try {
        // Send tools list changed notification
        server.notification({
          method: 'notifications/tools/list_changed',
          params: {}
        });

        // Send resources list changed notification
        server.notification({
          method: 'notifications/resources/list_changed',
          params: {}
        });

        // Send prompts list changed notification
        server.notification({
          method: 'notifications/prompts/list_changed',
          params: {}
        });

        successCount++;
        logger.debug('tool_gateway.notifications.sent', { sessionId });
      } catch (error: any) {
        errorCount++;
        logger.warn('tool_gateway.notifications.send_failed', {
          sessionId,
          error: error.message
        });
      }
    }

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
        .filter((t) => this.rbac.isAllowedTool(t, t.originServer ? this.serverConfigs.get(t.originServer) : undefined, context))
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
        resource.read?.({
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
    logger.info('tool_gateway.session.registered', {
      sessionId,
      agentName: context.agentName,
      totalSessions: this.sessionServers.size
    });

    // Discovery: listTools filtered by RBAC
    sessionServer.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      logger.debug('Handling ListToolsRequestSchema', {headers: extra.requestInfo?.headers});
      const trustedDiscovery = (context.agentName === 'llm-bot') || (Array.isArray(context.roles) && context.roles.includes('discovery'));
      const rawTools = Object.values(this.registry.getTools());
      const visibleTools = trustedDiscovery
        ? rawTools
        : rawTools.filter((t) => this.rbac.isAllowedTool(t, t.originServer ? this.serverConfigs.get(t.originServer) : undefined, context));
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
      logger.debug(`Returning ${tools.length} tools (trustedDiscovery=${trustedDiscovery})`);
      return { tools } as any;
    });

    // Discovery: listResources filtered by RBAC
    sessionServer.setRequestHandler(ListResourcesRequestSchema, async () => {
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
    sessionServer.setRequestHandler(ListPromptsRequestSchema, async () => {
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
    sessionServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const id = request.params.name;
      const tool = this.registry.getTool(id);
      if (!tool) throw new Error(`Tool not found: ${id}`);

      // Extract dynamic request context (roles/user)
      const reqContext = this.getRequestContext(request, extra, context);

      // Defense-in-depth RBAC check at invocation time using request-level context
      const allowed = this.rbac.isAllowedTool(tool, tool.originServer ? this.serverConfigs.get(tool.originServer) : undefined, reqContext);
      if (!allowed) throw new Error('Forbidden');

      const args = request.params.arguments || {};
      logger.debug('tool_gateway.mcp.call_tool.start', { id, args, reqContext });
      const start = Date.now();
      try {
        const result = await tool.execute?.(args as any, { 
          userRoles: reqContext.roles,
          userId: reqContext.userId,
          agentName: reqContext.agentName
        });
        const duration = Date.now() - start;
        logger.debug('tool_gateway.mcp.call_tool.success', { id, duration });

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
      }
    });

    // Invocation: readResource
    sessionServer.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
      const uri = request.params.uri;
      const resource = this.registry.getResource(uri);
      if (!resource) throw new Error(`Resource not found: ${uri}`);

      const reqContext = this.getRequestContext(request, extra, context);

      const allowed = this.rbac.isAllowedResource(resource, resource.originServer ? this.serverConfigs.get(resource.originServer) : undefined, reqContext);
      if (!allowed) throw new Error('Forbidden');

      logger.debug('tool_gateway.mcp.read_resource.start', { uri, reqContext });
      const start = Date.now();
      try {
        const result = await resource.read?.({
          userRoles: reqContext.roles,
          userId: reqContext.userId,
          agentName: reqContext.agentName
        });
        const duration = Date.now() - start;
        logger.debug('tool_gateway.mcp.read_resource.success', { uri, duration });
        return result as any;
      } catch (error: any) {
        const duration = Date.now() - start;
        logger.error('tool_gateway.mcp.read_resource.error', { uri, error: error.message, duration });
        throw error;
      }
    });

    // Invocation: getPrompt
    sessionServer.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
      const id = request.params.name;
      const prompt = this.registry.getPrompt(id);
      if (!prompt) throw new Error(`Prompt not found: ${id}`);

      const reqContext = this.getRequestContext(request, extra, context);

      const allowed = this.rbac.isAllowedPrompt(prompt, prompt.originServer ? this.serverConfigs.get(prompt.originServer) : undefined, reqContext);
      if (!allowed) throw new Error('Forbidden');

      const args = (request.params.arguments as Record<string, string>) || {};
      logger.debug('tool_gateway.mcp.get_prompt.start', { id, args, reqContext });
      const start = Date.now();
      try {
        const result = await prompt.get?.(args, {
          userRoles: reqContext.roles,
          userId: reqContext.userId,
          agentName: reqContext.agentName
        });
        const duration = Date.now() - start;
        logger.debug('tool_gateway.mcp.get_prompt.success', { id, duration });
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
