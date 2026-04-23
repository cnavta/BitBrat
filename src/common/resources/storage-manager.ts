import { Storage } from '@google-cloud/storage';
import type { ResourceManager, SetupContext } from './types';
import { logger as globalLogger } from '../logging';

export class StorageManager implements ResourceManager<Storage> {
  private storage: Storage | null = null;

  async setup(ctx: SetupContext): Promise<Storage> {
    const log = ctx?.logger || globalLogger;
    if (this.storage) {
      log.info('storage.manager.setup.reuse');
      return this.storage;
    }
    
    log.info('storage.manager.setup');
    this.storage = new Storage();
    return this.storage;
  }

  async shutdown(_instance: Storage): Promise<void> {
    // Storage client doesn't require explicit shutdown
  }
}
