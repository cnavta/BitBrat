import type { ResourceManager, SetupContext } from './types';
import type { IDocumentStore } from '../persistence/interfaces';
import { createDocumentStore } from '../persistence/factory';
import { logger as globalLogger } from '../logging';

let memoizedStore: IDocumentStore | null = null;

export class DocumentStoreManager implements ResourceManager<IDocumentStore> {
  setup(ctx: SetupContext): IDocumentStore {
    const log = ctx?.logger || globalLogger;
    if (memoizedStore) {
      log.info('document_store.manager.setup.reuse');
      return memoizedStore;
    }
    log.info('document_store.manager.setup');
    memoizedStore = createDocumentStore();
    return memoizedStore;
  }

  async shutdown(instance: IDocumentStore): Promise<void> {
    // DocumentStore implementations handle their own cleanup
    // PostgresDocumentStore closes pool in its shutdown method
    if (instance && typeof (instance as any).shutdown === 'function') {
      await (instance as any).shutdown();
    }
  }
}
