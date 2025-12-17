import type { InternalEventV2 } from '../../../types/events';

export type ConnectorState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export interface ConnectorSnapshot {
  state: ConnectorState;
  lastError?: { code?: string; message: string } | null;
  counters?: Record<string, number>;
  [k: string]: unknown;
}

export interface IngressConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSnapshot(): ConnectorSnapshot;
}

export interface IngressPublisher {
  publish(evt: InternalEventV2): Promise<void>;
}

export interface EnvelopeBuilder<TMeta> {
  build(meta: TMeta): InternalEventV2;
}

export interface EgressConnector {
  sendText(text: string, target?: string): Promise<void>;
}
