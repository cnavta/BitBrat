import { McpServer } from '../common/mcp-server';
import { Express, Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from '../services/llm-bot/tools/registry';
import { McpClientManager } from '../common/mcp/client-manager';
import { RegistryWatcher } from '../common/mcp/registry-watcher';
import { RbacEvaluator } from '../common/mcp/rbac';
import { McpServerConfig, SessionContext } from '../common/mcp/types';
import { ProxyInvoker } from '../common/mcp/proxy-invoker';

const SERVICE_NAME = process.env.SERVICE_NAME || 'tool-gateway';
const PORT = parseInt(process.env.SERVICE_PORT || process.env.PORT || '3000', 10);

class ToolGatewayServer extends McpServer {
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

    // MCP SSE endpoints are registered by McpServer constructor (/sse and /message)
  }

  protected async getMcpServerForConnection(req: Request): Promise<Server> {
    const context = this.extractSessionContext(req);

    const arch = (this.constructor as any).loadArchitectureYaml?.() || undefined;
    const svcNode = arch?.services?.[SERVICE_NAME] || {};
    const description = svcNode.description || 'BitBrat Tool Gateway (session)';
    const version = arch?.project?.version || '1.0.0';

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
      const tools = Object.values(this.registry.getTools())
        .filter((t) => this.rbac.isAllowedTool(t, t.originServer ? this.serverConfigs.get(t.originServer) : undefined, context))
        .map((t) => ({
          name: t.id,
          description: t.description,
          inputSchema: (t as any).inputSchema?.jsonSchema || {},
        }));
      return { tools } as any;
    });

    // Invocation: delegate to tool.execute (which proxies to upstream via McpBridge)
    sessionServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const id = request.params.name;
      const tool = this.registry.getTool(id);
      if (!tool) throw new Error(`Tool not found: ${id}`);

      // Defense-in-depth RBAC check at invocation time
      const allowed = this.rbac.isAllowedTool(tool, tool.originServer ? this.serverConfigs.get(tool.originServer) : undefined, context);
      if (!allowed) throw new Error('Forbidden');

      const args = request.params.arguments || {};
      const result = await tool.execute?.(args as any, { userRoles: context.roles });
      // Translate result to MCP CallToolResult-like content
      if (typeof result === 'string') {
        return { content: [{ type: 'text', text: result }] } as any;
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] } as any;
    });

    return sessionServer;
  }

  private extractSessionContext(req: Request): SessionContext {
    const auth = (req.headers['authorization'] || '').toString();
    const agentName = (req.headers['x-agent-name'] || '').toString();
    const roles = this.parseRolesFromAuth(auth, req.headers['x-roles']);
    return { roles, agentName };
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
