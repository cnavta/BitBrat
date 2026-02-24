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
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private serverConfigs: Map<string, McpServerConfig> = new Map();

  constructor(
    private server: BaseServer,
    private registry: IToolRegistry
  ) {
    // Lightweight monitor to re-attempt connections if not connected
    // In Jest/test environments, disable the monitor by default unless explicitly enabled via env
    const isJest = Boolean((global as any)?.jest || process.env.JEST_WORKER_ID);
    const rawMs = process.env.MCP_RECONNECT_MONITOR_MS;
    const monitorMs = Number(rawMs !== undefined ? rawMs : (isJest ? 0 : 5000));
    if (monitorMs > 0 && isFinite(monitorMs)) {
      const logger = (this.server as any).getLogger();
      const timer = setInterval(() => {
        try {
          for (const [name, cfg] of this.serverConfigs.entries()) {
            const st = this.stats.getServerStats(name)?.status;
            const hasClient = this.clients.has(name);
            if ((st !== 'connected' || !hasClient) && !this.reconnectTimers.has(name) && cfg.status !== 'inactive' && cfg.transport !== 'inactive') {
              logger.debug('mcp.client_manager.monitor_trigger', { name, status: st, hasClient });
              this.scheduleReconnect(name);
            }
          }
        } catch {}
      }, monitorMs);
      // Store as any to avoid NodeJS typings issues across environments
      (this as any)._monitorTimer = timer;
    }
  }

  getStats(): McpStatsCollector {
    return this.stats;
  }

  private scheduleReconnect(name: string) {
    const logger = (this.server as any).getLogger();
    const cfg = this.serverConfigs.get(name);
    if (!cfg) return;
    if (cfg.transport === 'inactive' || cfg.status === 'inactive') return;
    if (this.reconnectTimers.has(name)) return; // already scheduled

    const attempt = (this.reconnectAttempts.get(name) || 0) + 1;
    this.reconnectAttempts.set(name, attempt);

    const baseMs = Number(process.env.MCP_RECONNECT_BASE_MS || 1000);
    const maxMs = Number(process.env.MCP_RECONNECT_MAX_MS || 15000);
    const jitterFrac = Number(process.env.MCP_RECONNECT_JITTER || 0.2);

    let delay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
    const jitter = delay * jitterFrac * (Math.random() * 2 - 1);
    delay = Math.max(100, Math.floor(delay + jitter));

    logger.warn('mcp.client_manager.reconnect_scheduled', { name, attempt, delayMs: delay });

    const timer = setTimeout(async () => {
      try { this.reconnectTimers.delete(name); } catch {}
      await this.connectServer(cfg);
    }, delay);

    this.reconnectTimers.set(name, timer);
  }

  getInvoker(): ProxyInvoker {
    return this.invoker;
  }

  async connectServer(config: McpServerConfig): Promise<void> {
    // cache latest config for reconnects
    this.serverConfigs.set(config.name, { ...config });
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
      if (config.transport === 'inactive' || config.status === 'inactive') {
        // Clear any pending reconnects when explicitly inactive
        const t = this.reconnectTimers.get(config.name);
        if (t) { clearTimeout(t); this.reconnectTimers.delete(config.name); }
        this.reconnectAttempts.delete(config.name);
        logger.info('mcp.client_manager.skipping_inactive', { name: config.name });
        return;
      }

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
          throw new Error(`Stdio transport requires a command for server ${config.name}. Config: ${JSON.stringify(config)}`);
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
      // Clear any scheduled reconnects/attempts upon successful connection
      const t = this.reconnectTimers.get(config.name);
      if (t) { clearTimeout(t); this.reconnectTimers.delete(config.name); }
      this.reconnectAttempts.delete(config.name);

      const bridge = new McpBridge(client, config.name, this.stats, this.invoker);
      this.bridges.set(config.name, bridge);

      // Initial discovery
      await this.discoverTools(config.name, config.requiredRoles);
      await this.discoverResources(config.name, config.requiredRoles);
      await this.discoverPrompts(config.name, config.requiredRoles);

      logger.info('mcp.client_manager.connected', { name: config.name });
    } catch (e) {
      this.stats.updateServerStatus(config.name, 'error');
      logger.error('mcp.client_manager.connect_error', { name: config.name, error: e });
      // Schedule reconnect for transient failures
      this.scheduleReconnect(config.name);
    }
  }

  async disconnectServer(name: string): Promise<void> {
    // Cancel any pending reconnects
    const t = this.reconnectTimers.get(name);
    if (t) { clearTimeout(t); this.reconnectTimers.delete(name); }
    this.reconnectAttempts.delete(name);
    this.serverConfigs.delete(name);
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

    // Check capabilities if available
    const capabilities = (client as any).getServerCapabilities?.();
    if (capabilities && capabilities.tools === false) {
      logger.debug('mcp.client_manager.skipping_tools_discovery', { server: serverName, reason: 'Server does not declare tools capability' });
      return;
    }

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
    } catch (e: any) {
      if (e?.code === -32601) {
        logger.info('mcp.client_manager.tools_not_supported', { name: serverName });
      } else {
        logger.error('mcp.client_manager.discovery_error', { name: serverName, type: 'tools', error: e });
      }
    }
  }

  async discoverResources(serverName: string, requiredRoles?: string[]): Promise<void> {
    const client = this.clients.get(serverName);
    const bridge = this.bridges.get(serverName);
    const logger = (this.server as any).getLogger();

    if (!client || !bridge) return;

    // Check capabilities if available
    const capabilities = (client as any).getServerCapabilities?.();
    if (capabilities && capabilities.resources === false) {
      logger.debug('mcp.client_manager.skipping_resources_discovery', { server: serverName, reason: 'Server does not declare resources capability' });
      return;
    }

    const uris: string[] = [];
    try {
      const result = await client.listResources();
      for (const resource of result.resources) {
        const translated = bridge.translateResource(resource, requiredRoles);
        this.registry.registerResource(translated);
        uris.push(translated.uri);
      }
      this.serverResources.set(serverName, uris);
    } catch (e: any) {
      if (e?.code === -32601) {
        logger.info('mcp.client_manager.resources_not_supported', { name: serverName });
      } else {
        logger.error('mcp.client_manager.discovery_error', { name: serverName, type: 'resources', error: e });
      }
    }
  }

  async discoverPrompts(serverName: string, requiredRoles?: string[]): Promise<void> {
    const client = this.clients.get(serverName);
    const bridge = this.bridges.get(serverName);
    const logger = (this.server as any).getLogger();

    if (!client || !bridge) return;

    // Check capabilities if available
    const capabilities = (client as any).getServerCapabilities?.();
    if (capabilities && capabilities.prompts === false) {
      logger.debug('mcp.client_manager.skipping_prompts_discovery', { server: serverName, reason: 'Server does not declare prompts capability' });
      return;
    }

    const ids: string[] = [];
    try {
      const result = await client.listPrompts();
      for (const prompt of result.prompts) {
        const translated = bridge.translatePrompt(prompt, requiredRoles);
        this.registry.registerPrompt(translated);
        ids.push(translated.id);
      }
      this.serverPrompts.set(serverName, ids);
    } catch (e: any) {
      if (e?.code === -32601) {
        logger.info('mcp.client_manager.prompts_not_supported', { name: serverName });
      } else {
        logger.error('mcp.client_manager.discovery_error', { name: serverName, type: 'prompts', error: e });
      }
    }
  }

  async shutdown(): Promise<void> {
    // Stop monitor
    try {
      const t = (this as any)._monitorTimer as ReturnType<typeof setInterval> | undefined;
      if (t) clearInterval(t);
    } catch {}
    // Clear any scheduled reconnects
    for (const t of this.reconnectTimers.values()) { try { clearTimeout(t); } catch {} }
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    for (const name of Array.from(this.clients.keys())) {
      await this.disconnectServer(name);
    }
  }
}
