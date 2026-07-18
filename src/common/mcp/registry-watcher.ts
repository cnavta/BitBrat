import { Bit } from '../base-server';
import { McpServerConfig } from './types';

export interface RegistryWatcherOptions {
  onServerActive: (config: McpServerConfig) => Promise<void>;
  onServerInactive: (name: string) => Promise<void>;
  store: any; // IMcpServerStore (avoiding circular import) - required
}

export class RegistryWatcher {
  private unsubscribe?: () => void;
  private logger: any;
  private previousConfigs: Map<string, McpServerConfig> = new Map();
  private store: any;

  constructor(private server: Bit, private options: RegistryWatcherOptions) {
    this.logger = (server as any).getLogger();
    this.store = this.options.store;
  }

  start() {
    this.logger.info('mcp.registry_watcher.starting');

    this.unsubscribe = this.store.watch((configs: McpServerConfig[]) => {
      this.logger.debug('mcp.registry_watcher.snapshot_received', {
        count: configs.length,
      });

      // Track current server names to detect removals
      const currentNames = new Set(configs.map(c => c.name));
      const previousNames = new Set(this.previousConfigs.keys());

      // Detect removed servers
      for (const name of previousNames) {
        if (!currentNames.has(name)) {
          this.logger.debug('mcp.registry_watcher.removed', { name });
          this.options.onServerInactive(name).catch(error => {
            this.logger.error('mcp.registry_watcher.inactive_handler_error', { name, error });
          });
        }
      }

      // Process current configs
      for (const config of configs) {
        const name = config.name;
        const status = config.status || 'active';

        this.logger.debug('mcp.registry_watcher.config', {
          name,
          status,
          hasCommand: !!config.command,
          command: config.command,
        });

        if (status === 'inactive') {
          this.options.onServerInactive(name).catch(error => {
            this.logger.error('mcp.registry_watcher.inactive_handler_error', { name, error });
          });
          this.previousConfigs.delete(name);
          continue;
        }

        // Simple validation before calling onServerActive
        const transport = config.transport || 'stdio';
        if (transport === 'stdio' && !config.command) {
          this.logger.warn('mcp.registry_watcher.invalid_config', {
            name,
            error: 'Stdio transport requires a command',
            config
          });
          continue;
        }
        if (transport === 'sse' && !config.url) {
          this.logger.warn('mcp.registry_watcher.invalid_config', {
            name,
            error: 'SSE transport requires a URL',
            config
          });
          continue;
        }

        // Only call onServerActive if config changed
        const previous = this.previousConfigs.get(name);
        const configChanged = !previous || JSON.stringify(previous) !== JSON.stringify(config);

        if (configChanged) {
          this.logger.debug('mcp.registry_watcher.config_changed', { name, isNew: !previous });
          this.options.onServerActive(config).catch(error => {
            this.logger.error('mcp.registry_watcher.active_handler_error', { name, error });
          });
          this.previousConfigs.set(name, config);
        }
      }
    });
  }

  stop() {
    this.logger.info('mcp.registry_watcher.stopping');
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
}
