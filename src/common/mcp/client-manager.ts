import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { McpBridge } from './bridge';
import { IToolRegistry } from '../../types/tools';
import { BaseServer } from '../base-server';
import { McpStatsCollector } from './stats-collector';
import { McpServerConfig } from './types';
import { ProxyInvoker } from './proxy-invoker';

export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private bridges: Map<string, McpBridge> = new Map();
  private serverTools: Map<string, string[]> = new Map();
  private serverResources: Map<string, string[]> = new Map();
  private serverPrompts: Map<string, string[]> = new Map();
  private stats = new McpStatsCollector();
  private invoker = new ProxyInvoker();

  constructor(
    private server: BaseServer,
    private registry: IToolRegistry
  ) {}

  getStats(): McpStatsCollector {
    return this.stats;
  }

  getInvoker(): ProxyInvoker {
    return this.invoker;
  }

  async connectServer(config: McpServerConfig): Promise<void> {
    const logger = (this.server as any).getLogger();

    if (this.clients.has(config.name)) {
      logger.info('mcp.client_manager.restarting', { name: config.name });
      await this.disconnectServer(config.name);
    }

    logger.info('mcp.client_manager.connecting', { 
      name: config.name, 
      transport: config.transport || 'stdio',
      url: config.url,
      command: config.command 
    });

    const transportType = config.transport || 'stdio';
    this.stats.updateServerStatus(config.name, 'connecting', transportType);

    try {
      let transport;
      if (config.transport === 'sse') {
        if (!config.url) {
          throw new Error(`SSE transport requires a URL for server ${config.name}`);
        }
        transport = new SSEClientTransport(new URL(config.url), {
          requestInit: {
            headers: config.env
          }
        });
      } else {
        if (!config.command) {
          throw new Error(`Stdio transport requires a command for server ${config.name}`);
        }
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: Object.fromEntries(
            Object.entries({ ...process.env, ...config.env })
              .filter(([_, v]) => v !== undefined)
          ) as Record<string, string>,
        });
      }

      const client = new Client({
        name: 'bitbrat-llm-bot',
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      await client.connect(transport);
      this.clients.set(config.name, client);
      this.stats.updateServerStatus(config.name, 'connected');

      const bridge = new McpBridge(client, config.name, this.stats, this.invoker);
      this.bridges.set(config.name, bridge);

      // Initial discovery
      await this.discoverTools(config.name, config.requiredRoles);
      await this.discoverResources(config.name, config.requiredRoles);
      await this.discoverPrompts(config.name, config.requiredRoles);

      logger.info('mcp.client_manager.connected', { name: config.name });
    } catch (e) {
      console.error('mcp.client_manager.connect_error_debug', e);
      this.stats.updateServerStatus(config.name, 'error');
      logger.error('mcp.client_manager.connect_error', { name: config.name, error: e });
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const logger = (this.server as any).getLogger();
    const client = this.clients.get(name);
    
    this.stats.updateServerStatus(name, 'disconnected');

    if (client) {
      try {
        await client.close();
      } catch (e) {
        // Ignore close errors
      }
      this.clients.delete(name);
    }
    this.bridges.delete(name);

    // Remove tools associated with this server
    const toolIds = this.serverTools.get(name) || [];
    logger.debug('mcp.client_manager.unregistering_tools', { name, count: toolIds.length, toolIds });
    for (const id of toolIds) {
      this.registry.unregisterTool(id);
    }
    this.serverTools.delete(name);

    // Remove resources
    const resourceUris = this.serverResources.get(name) || [];
    for (const uri of resourceUris) {
      this.registry.unregisterResource(uri);
    }
    this.serverResources.delete(name);

    // Remove prompts
    const promptIds = this.serverPrompts.get(name) || [];
    for (const id of promptIds) {
      this.registry.unregisterPrompt(id);
    }
    this.serverPrompts.delete(name);

    logger.info('mcp.client_manager.disconnected', { name });
  }

  async discoverTools(serverName: string, requiredRoles?: string[]): Promise<void> {
    const client = this.clients.get(serverName);
    const bridge = this.bridges.get(serverName);
    const logger = (this.server as any).getLogger();

    if (!client || !bridge) return;

    const toolIds: string[] = [];
    const start = Date.now();
    try {
      const result = await client.listTools();
      const duration = Date.now() - start;
      this.stats.recordDiscovery(serverName, result.tools.length, duration);

      logger.debug('mcp.client_manager.tools_discovered', { 
        server: serverName, 
        count: result.tools.length,
        toolNames: result.tools.map(t => t.name)
      });
      for (const tool of result.tools) {
        const translated = bridge.translateTool(tool, requiredRoles);
        this.registry.registerTool(translated);
        toolIds.push(translated.id);
        logger.debug('mcp.client_manager.tool_registered', { server: serverName, tool: tool.name });
      }
      this.serverTools.set(serverName, toolIds);
      this.stats.updateServerTools(serverName, toolIds);
    } catch (e) {
      logger.error('mcp.client_manager.discovery_error', { name: serverName, type: 'tools', error: e });
    }
  }

  async discoverResources(serverName: string, requiredRoles?: string[]): Promise<void> {
    const client = this.clients.get(serverName);
    const bridge = this.bridges.get(serverName);
    const logger = (this.server as any).getLogger();

    if (!client || !bridge) return;

    const uris: string[] = [];
    try {
      const result = await client.listResources();
      for (const resource of result.resources) {
        const translated = bridge.translateResource(resource, requiredRoles);
        this.registry.registerResource(translated);
        uris.push(translated.uri);
      }
      this.serverResources.set(serverName, uris);
    } catch (e) {
      logger.error('mcp.client_manager.discovery_error', { name: serverName, type: 'resources', error: e });
    }
  }

  async discoverPrompts(serverName: string, requiredRoles?: string[]): Promise<void> {
    const client = this.clients.get(serverName);
    const bridge = this.bridges.get(serverName);
    const logger = (this.server as any).getLogger();

    if (!client || !bridge) return;

    const ids: string[] = [];
    try {
      const result = await client.listPrompts();
      for (const prompt of result.prompts) {
        const translated = bridge.translatePrompt(prompt, requiredRoles);
        this.registry.registerPrompt(translated);
        ids.push(translated.id);
      }
      this.serverPrompts.set(serverName, ids);
    } catch (e) {
      logger.error('mcp.client_manager.discovery_error', { name: serverName, type: 'prompts', error: e });
    }
  }

  async shutdown(): Promise<void> {
    for (const name of Array.from(this.clients.keys())) {
      await this.disconnectServer(name);
    }
  }
}
