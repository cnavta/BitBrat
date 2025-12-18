import { ConnectorSnapshot, IngressConnector } from './interfaces';

type RegistryItem = {
  name: string;
  connector: IngressConnector;
  started: boolean;
};

export class ConnectorManager {
  private readonly registry = new Map<string, RegistryItem>();
  constructor(private readonly opts: { logger?: { info?: Function; debug?: Function; warn?: Function; error?: Function } } = {}) {}

  register(name: string, connector: IngressConnector): void {
    if (!name) throw new Error('connector_name_required');
    this.registry.set(name, { name, connector, started: false });
    this.opts.logger?.debug?.('connector.register', { name });
  }

  getConnector(name: string): IngressConnector | undefined {
    return this.registry.get(name)?.connector;
  }

  async start(name?: string): Promise<void> {
    if (name) {
      const item = this.registry.get(name);
      if (!item) return;
      await item.connector.start();
      item.started = true;
      this.opts.logger?.info?.('connector.started', { name });
      return;
    }
    // start all
    for (const [n, item] of this.registry.entries()) {
      try {
        await item.connector.start();
        item.started = true;
        this.opts.logger?.info?.('connector.started', { name: n });
      } catch (e: any) {
        this.opts.logger?.error?.('connector.start_error', { name: n, error: e?.message || String(e) });
      }
    }
  }

  async stop(name?: string): Promise<void> {
    if (name) {
      const item = this.registry.get(name);
      if (!item) return;
      try {
        await item.connector.stop();
      } finally {
        item.started = false;
      }
      this.opts.logger?.info?.('connector.stopped', { name });
      return;
    }
    for (const [n, item] of this.registry.entries()) {
      try {
        await item.connector.stop();
      } catch (e: any) {
        this.opts.logger?.warn?.('connector.stop_error', { name: n, error: e?.message || String(e) });
      } finally {
        item.started = false;
      }
      this.opts.logger?.info?.('connector.stopped', { name: n });
    }
  }

  /** Returns snapshot keyed by connector name, with started flags. */
  getSnapshot(): Record<string, ConnectorSnapshot & { started: boolean }> {
    const out: Record<string, ConnectorSnapshot & { started: boolean }> = {};
    for (const [name, item] of this.registry.entries()) {
      try {
        const snap = item.connector.getSnapshot();
        out[name] = { ...snap, started: item.started } as any;
      } catch (e: any) {
        out[name] = { state: 'ERROR', lastError: { message: e?.message || String(e) }, started: item.started } as any;
      }
    }
    return out;
  }
}
