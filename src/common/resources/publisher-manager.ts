import type { ResourceManager, SetupContext } from './types';
import type { MessagePublisher } from '../../services/message-bus';
import { createMessagePublisher } from '../../services/message-bus';
import { logger as globalLogger } from '../logging';

export type PublisherResource = {
  /** Create or retrieve a cached MessagePublisher for the subject */
  create: (subject: string) => MessagePublisher;
  /** Flush all cached publishers best-effort */
  flushAll: () => Promise<void>;
};

export class PublisherManager implements ResourceManager<PublisherResource> {
  private cache = new Map<string, MessagePublisher>();

  setup(ctx: SetupContext): PublisherResource {
    const log = ctx?.logger || globalLogger;
    log.info('publisher.manager.setup');
    const create = (subject: string): MessagePublisher => {
      const key = String(subject || '').trim();
      if (!key) throw new Error('publisher.manager: subject required');
      let pub = this.cache.get(key);
      if (!pub) {
        pub = createMessagePublisher(key);
        this.cache.set(key, pub);
      }
      return pub;
    };
    const flushAll = async () => {
      const pubs = Array.from(this.cache.values());
      for (const p of pubs) {
        try { await p.flush(); } catch (e: any) {
          log.warn('publisher.manager.flush.error', { error: e?.message || String(e) });
        }
      }
    };
    return { create, flushAll };
  }

  async shutdown(_instance: PublisherResource): Promise<void> {
    try {
      // Best-effort flush and clear cache
      const pubs = Array.from(this.cache.values());
      for (const p of pubs) {
        try { await p.flush(); } catch {}
      }
    } finally {
      this.cache.clear();
    }
  }
}
