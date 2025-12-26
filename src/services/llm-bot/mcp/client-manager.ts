import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpBridge } from './bridge';
import { IToolRegistry } from '../../../types/tools';
import { BaseServer } from '../../../common/base-server';
import { getFirestore } from '../../../common/firebase';

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  requiredRoles?: string[];
}

export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private bridges: Map<string, McpBridge> = new Map();
  private serverTools: Map<string, string[]> = new Map();
  private unsubscribe?: () => void;

  constructor(
    private server: BaseServer,
    private registry: IToolRegistry
  ) {}

  async initFromConfig(): Promise<void> {
    // Legacy support or just start watching
    await this.watchRegistry();
  }

  async watchRegistry(): Promise<void> {
    const logger = (this.server as any).getLogger();
    const db = getFirestore();

    logger.info('mcp.client_manager.watching_registry');

    this.unsubscribe = db.collection('mcp_servers')
      .onSnapshot(async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const data = change.doc.data() as McpServerConfig & { status?: string };
          const name = data.name || change.doc.id;

          if (change.type === 'removed' || data.status === 'inactive') {
            await this.disconnectServer(name);
          } else if (data.status === 'active' || !data.status) {
            // Added or modified
            await this.connectServer({ ...data, name });
          }
        }
      }, (err) => {
        logger.error('mcp.client_manager.watch_error', { error: err });
      });
  }

  async connectServer(config: McpServerConfig): Promise<void> {
    const logger = (this.server as any).getLogger();

    if (this.clients.has(config.name)) {
      logger.info('mcp.client_manager.restarting', { name: config.name });
      await this.disconnectServer(config.name);
    }

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
      await this.discoverTools(config.name, config.requiredRoles);

      logger.info('mcp.client_manager.connected', { name: config.name });
    } catch (e) {
      logger.error('mcp.client_manager.connect_error', { name: config.name, error: e });
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const logger = (this.server as any).getLogger();
    const client = this.clients.get(name);
    
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
    for (const id of toolIds) {
      this.registry.unregisterTool(id);
    }
    this.serverTools.delete(name);

    logger.info('mcp.client_manager.disconnected', { name });
  }

  async discoverTools(serverName: string, requiredRoles?: string[]): Promise<void> {
    const client = this.clients.get(serverName);
    const bridge = this.bridges.get(serverName);
    const logger = (this.server as any).getLogger();

    if (!client || !bridge) return;

    const toolIds: string[] = [];
    try {
      const result = await client.listTools();
      for (const tool of result.tools) {
        const translated = bridge.translateTool(tool, requiredRoles);
        this.registry.registerTool(translated);
        toolIds.push(translated.id);
        logger.debug('mcp.client_manager.tool_registered', { server: serverName, tool: tool.name });
      }
      this.serverTools.set(serverName, toolIds);
    } catch (e) {
      logger.error('mcp.client_manager.discovery_error', { name: serverName, error: e });
    }
  }

  async shutdown(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    for (const name of Array.from(this.clients.keys())) {
      await this.disconnectServer(name);
    }
  }
}
