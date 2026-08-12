import type { IngressConnector, ConnectorSnapshot, ConnectorMetadata } from '../core';
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

  async banUser(platformUserId: string, reason?: string): Promise<void> {
    if (typeof (this.client as any).banUser === 'function') {
      await (this.client as any).banUser(platformUserId, reason);
    }
  }

  async sendText(text: string, target?: string): Promise<void> {
    if (typeof (this.client as any).sendText === 'function') {
      await (this.client as any).sendText(text, target);
    }
  }

  async sendWhisper(text: string, userId: string): Promise<void> {
    if (typeof (this.client as any).sendWhisper === 'function') {
      await (this.client as any).sendWhisper(text, userId);
    }
  }

  getMetadata(): ConnectorMetadata {
    return {
      platform: 'twitch',
      version: '1.0.0',
      authMethod: 'oauth2',
      capabilities: {
        ingress: {
          method: 'websocket',
          realtime: true,
          requiresWebhook: false,
          requiresPublicUrl: false,
        },
        egress: {
          chat: true,
          dm: true,
          reactions: false,
          threads: false,
        },
        moderation: {
          ban: true,
          timeout: true,
          delete: true,
        },
      },
    };
  }

  getSnapshot(): ConnectorSnapshot {
    const s: TwitchIrcDebugSnapshot = this.client.getSnapshot();
    return {
      state: mapState(s.state),
      id: s.userId,
      displayName: s.displayName,
      lastError: s.lastError || undefined,
      counters: s.counters || undefined,
      joinedChannels: Array.isArray(s.joinedChannels) ? [...s.joinedChannels] : [],
      reconnects: s.reconnects,
      lastMessageAt: s.lastMessageAt,
    } as ConnectorSnapshot & Record<string, unknown>;
  }
}
