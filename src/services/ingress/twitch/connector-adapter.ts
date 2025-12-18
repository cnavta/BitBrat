import type { IngressConnector, ConnectorSnapshot } from '../core';
import type { ITwitchIrcClient, TwitchIrcDebugSnapshot, TwitchConnectionState } from './twitch-irc-client';

function mapState(state: TwitchConnectionState): ConnectorSnapshot['state'] {
  switch (state) {
    case 'CONNECTED':
      return 'CONNECTED';
    case 'CONNECTING':
    case 'RECONNECTING':
      return 'CONNECTING';
    case 'DISCONNECTED':
      return 'DISCONNECTED';
    case 'ERROR':
    default:
      return 'ERROR';
  }
}

export class TwitchConnectorAdapter implements IngressConnector {
  constructor(private readonly client: ITwitchIrcClient) {}

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  getSnapshot(): ConnectorSnapshot {
    const s: TwitchIrcDebugSnapshot = this.client.getSnapshot();
    return {
      state: mapState(s.state),
      lastError: s.lastError || undefined,
      counters: s.counters || undefined,
      joinedChannels: Array.isArray(s.joinedChannels) ? [...s.joinedChannels] : [],
      reconnects: s.reconnects,
      lastMessageAt: s.lastMessageAt,
    } as ConnectorSnapshot & Record<string, unknown>;
  }
}
