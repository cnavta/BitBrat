import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpBridge } from './bridge';
import { IToolRegistry } from '../../../types/tools';
import { BaseServer } from '../../../common/base-server';

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private bridges: Map<string, McpBridge> = new Map();

  constructor(
    private server: BaseServer,
    private registry: IToolRegistry
  ) {}

  async initFromConfig(): Promise<void> {
    const logger = (this.server as any).getLogger();
    const configStr = this.server.getConfig<string>('LLM_BOT_MCP_SERVERS', { default: '[]' });
    
    try {
      const serverConfigs: McpServerConfig[] = JSON.parse(configStr);
      for (const cfg of serverConfigs) {
        await this.connectServer(cfg);
      }
    } catch (e) {
      logger.error('mcp.client_manager.init_error', { error: e });
    }
  }

  async connectServer(config: McpServerConfig): Promise<void> {
    const logger = (this.server as any).getLogger();
    logger.info('mcp.client_manager.connecting', { name: config.name, command: config.command });

    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: Object.fromEntries(
          Object.entries({ ...process.env, ...config.env })
            .filter(([_, v]) => v !== undefined)
        ) as Record<string, string>,
      });

      const client = new Client({
        name: 'bitbrat-llm-bot',
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      await client.connect(transport);
      this.clients.set(config.name, client);

      const bridge = new McpBridge(client);
      this.bridges.set(config.name, bridge);

      // Initial discovery
      await this.discoverTools(config.name);

      logger.info('mcp.client_manager.connected', { name: config.name });
    } catch (e) {
      logger.error('mcp.client_manager.connect_error', { name: config.name, error: e });
    }
  }

  async discoverTools(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    const bridge = this.bridges.get(serverName);
    const logger = (this.server as any).getLogger();

    if (!client || !bridge) return;

    try {
      const result = await client.listTools();
      for (const tool of result.tools) {
        const translated = bridge.translateTool(tool);
        // Prefix tool name with server name to avoid collisions if necessary
        // In McpBridge we already prefix with mcp:
        this.registry.registerTool(translated);
        logger.debug('mcp.client_manager.tool_registered', { server: serverName, tool: tool.name });
      }
    } catch (e) {
      logger.error('mcp.client_manager.discovery_error', { name: serverName, error: e });
    }
  }

  async shutdown(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    this.clients.clear();
    this.bridges.clear();
  }
}
