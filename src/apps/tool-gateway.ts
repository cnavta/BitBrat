import { McpServer } from '../common/mcp-server';
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
import { ProxyInvoker } from '../common/mcp/proxy-invoker';

const SERVICE_NAME = process.env.SERVICE_NAME || 'tool-gateway';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

export class ToolGatewayServer extends McpServer {
  private registry = new ToolRegistry();
  private mcpManager = new McpClientManager(this as any, this.registry);
  private registryWatcher?: RegistryWatcher;
  private serverConfigs: Map<string, McpServerConfig> = new Map();
  private rbac = new RbacEvaluator();
  private invoker: ProxyInvoker;

  constructor() {
    super({ serviceName: SERVICE_NAME });
    this.invoker = this.mcpManager.getInvoker();
    this.setupApp(this.getApp() as any);
  }

  async start(port: number) {
    // Initialize MCP Registry Watcher to populate upstream tools
    this.registryWatcher = new RegistryWatcher(this as any, {
      onServerActive: async (config) => {
        this.serverConfigs.set(config.name, config);
        await this.mcpManager.connectServer(config);
      },
      onServerInactive: async (name) => {
        this.serverConfigs.delete(name);
        await this.mcpManager.disconnectServer(name);
      },
    });
    this.registryWatcher.start();

    return super.start(port);
  }

  async close(reason?: string) {
    if (this.registryWatcher) this.registryWatcher.stop();
    await this.mcpManager.shutdown();
    return super.close(reason);
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
      const tool = this.registry.getTool(toolId);

      if (!tool) return res.status(404).json({ error: 'Tool not found' });
      
      const allowed = this.rbac.isAllowedTool(tool, tool.originServer ? this.serverConfigs.get(tool.originServer) : undefined, context);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });

      try {
        const args = req.body.args || req.body.arguments || req.body;
        const result = await tool.execute?.(args as any, { 
          userRoles: context.roles,
          userId: context.userId,
          agentName: context.agentName
        });
        res.json({ result });
      } catch (error: any) {
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

        resource.read?.({
          userRoles: context.roles,
          userId: context.userId,
          agentName: context.agentName
        }).then(result => res.json({ result })).catch(e => res.status(500).json({ error: e.message }));
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

    const sessionServer = new Server(
      {
        name: `${SERVICE_NAME}-session`,
        version,
        description,
      } as any,
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // Discovery: listTools filtered by RBAC
    sessionServer.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Handling ListToolsRequestSchema');
      const tools = Object.values(this.registry.getTools())
        .filter((t) => this.rbac.isAllowedTool(t, t.originServer ? this.serverConfigs.get(t.originServer) : undefined, context))
        .map((t) => ({
          name: t.id,
          description: t.description,
          inputSchema: (t as any).inputSchema?.jsonSchema || {},
        }));
      logger.debug(`Returning ${tools.length} tools`);
      return { tools } as any;
    });

    // Discovery: listResources filtered by RBAC
    sessionServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Object.values(this.registry.getResources())
        .filter((r) => this.rbac.isAllowedResource(r, r.originServer ? this.serverConfigs.get(r.originServer) : undefined, context))
        .map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
      return { resources } as any;
    });

    // Discovery: listPrompts filtered by RBAC
    sessionServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = Object.values(this.registry.getPrompts())
        .filter((p) => this.rbac.isAllowedPrompt(p, p.originServer ? this.serverConfigs.get(p.originServer) : undefined, context))
        .map((p) => ({
          name: p.id,
          description: p.description,
          arguments: p.arguments,
        }));
      return { prompts } as any;
    });

    // Invocation: callTool
    sessionServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const id = request.params.name;
      const tool = this.registry.getTool(id);
      if (!tool) throw new Error(`Tool not found: ${id}`);

      // Defense-in-depth RBAC check at invocation time
      const allowed = this.rbac.isAllowedTool(tool, tool.originServer ? this.serverConfigs.get(tool.originServer) : undefined, context);
      if (!allowed) throw new Error('Forbidden');

      const args = request.params.arguments || {};
      const result = await tool.execute?.(args as any, { 
        userRoles: context.roles,
        userId: context.userId,
        agentName: context.agentName
      });
      // Translate result to MCP CallToolResult-like content
      if (typeof result === 'string') {
        return { content: [{ type: 'text', text: result }] } as any;
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] } as any;
    });

    // Invocation: readResource
    sessionServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const resource = this.registry.getResource(uri);
      if (!resource) throw new Error(`Resource not found: ${uri}`);

      const allowed = this.rbac.isAllowedResource(resource, resource.originServer ? this.serverConfigs.get(resource.originServer) : undefined, context);
      if (!allowed) throw new Error('Forbidden');

      return await resource.read?.({
        userRoles: context.roles,
        userId: context.userId,
        agentName: context.agentName
      }) as any;
    });

    // Invocation: getPrompt
    sessionServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const id = request.params.name;
      const prompt = this.registry.getPrompt(id);
      if (!prompt) throw new Error(`Prompt not found: ${id}`);

      const allowed = this.rbac.isAllowedPrompt(prompt, prompt.originServer ? this.serverConfigs.get(prompt.originServer) : undefined, context);
      if (!allowed) throw new Error('Forbidden');

      const args = (request.params.arguments as Record<string, string>) || {};
      return await prompt.get?.(args, {
        userRoles: context.roles,
        userId: context.userId,
        agentName: context.agentName
      }) as any;
    });

    return sessionServer;
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

export function createApp() {
  const server = new ToolGatewayServer();
  return server.getApp();
}

if (require.main === module) {
  const server = new ToolGatewayServer();
  void server.start(PORT);
}
