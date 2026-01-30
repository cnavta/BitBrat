import crypto from 'crypto';
import type { EnvelopeBuilder } from '../core';
import type { InternalEventV2 } from '../../../types/events';
import type { DiscordMessageMeta } from './discord-ingress-client';

export class DiscordEnvelopeBuilder implements EnvelopeBuilder<DiscordMessageMeta> {
  build(
    meta: DiscordMessageMeta,
    opts?: { uuid?: () => string; nowIso?: () => string; egressDestination?: string }
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());

    const correlationId = uuid();
    const traceId = uuid();

    const evt: InternalEventV2 = {
      v: '2',
      type: 'chat.message.v1',
      correlationId,
      traceId,
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.discord',
        channel: meta.channelId,
      },
      identity: {
        external: {
          id: meta.authorId,
          platform: 'discord',
          displayName: meta.authorName,
          metadata: {
            guildId: meta.guildId,
            roles: meta.roles || [],
            isOwner: !!meta.isOwner,
          }
        }
      },
      egress: { 
        destination: opts?.egressDestination || '',
        type: 'chat'
      },
      message: {
        id: meta.messageId || `msg-${correlationId}`,
        role: 'user',
        text: meta.content,
        rawPlatformPayload: {
          content: meta.content,
          guildId: meta.guildId,
          channelId: meta.channelId,
          authorId: meta.authorId,
          authorName: meta.authorName,
          mentions: meta.mentions || [],
          roles: meta.roles || [],
          isOwner: !!meta.isOwner,
          timestamp: nowIso(),
        },
      },
      annotations: [
        {
          id: uuid(),
          kind: 'custom',
          source: 'discord',
          createdAt: nowIso(),
          label: 'source',
          payload: {
            guildId: meta.guildId,
            channelId: meta.channelId,
            authorName: meta.authorName,
          },
        },
      ],
    };
    return evt;
  }
}
