import { getFirestore } from '../firebase';
import { BaseServer } from '../base-server';
import { McpServerConfig } from './types';

export interface RegistryWatcherOptions {
  onServerActive: (config: McpServerConfig) => Promise<void>;
  onServerInactive: (name: string) => Promise<void>;
}

export class RegistryWatcher {
  private unsubscribe?: () => void;
  private logger: any;

  constructor(private server: BaseServer, private options: RegistryWatcherOptions) {
    this.logger = (server as any).getLogger();
  }

  start() {
    const db = getFirestore();
    this.logger.info('mcp.registry_watcher.starting');

    this.unsubscribe = db.collection('mcp_servers').onSnapshot(async (snapshot) => {
      this.logger.debug('mcp.registry_watcher.snapshot_received', {
        count: snapshot.size,
        changes: snapshot.docChanges().length,
      });

      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        const name = data.name || change.doc.id;
        const status = data.status || 'active';

        this.logger.debug('mcp.registry_watcher.change', {
          type: change.type,
          name,
          status,
        });

        if (change.type === 'removed' || status === 'inactive') {
          await this.options.onServerInactive(name);
        } else {
          // data is essentially McpServerConfig
          const config: McpServerConfig = {
            ...data,
            name,
            status,
          } as McpServerConfig;
          await this.options.onServerActive(config);
        }
      }
    }, (error) => {
      this.logger.error('mcp.registry_watcher.error', { error });
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
