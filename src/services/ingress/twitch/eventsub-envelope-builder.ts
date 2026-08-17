import { InternalEventV2, ExternalEventV1 } from '../../../types/events';
import { EnvelopeBuilderOptions } from './envelope-builder';
import crypto from 'crypto';

/**
 * EventSubEnvelopeBuilder — Normalizes Twitch EventSub events into InternalEventV2.
 */
export class EventSubEnvelopeBuilder {
  /**
   * Maps a channel.follow event to InternalEventV2.
   */
  buildFollow(
    event: {
      userId: string;
      userName: string;
      userDisplayName: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      followDate: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `eventsub-${correlationId}`, // Twurple EventSub events don't always expose a unique event ID directly on the event object
      source: 'twitch.eventsub',
      kind: 'channel.follow',
      version: '2',
      createdAt: event.followDate.toISOString(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.follow',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId,
          platform: 'twitch',
          displayName: event.userDisplayName,
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.update event to InternalEventV2.
   */
  buildUpdate(
    event: {
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      streamTitle: string;
      streamLanguage: string;
      categoryId: string;
      categoryName: string;
      isMature: boolean;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `eventsub-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.update',
      version: '2',
      createdAt: nowIso(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        title: event.streamTitle,
        language: event.streamLanguage,
        categoryId: event.categoryId,
        categoryName: event.categoryName,
        isMature: event.isMature,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.update',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a stream.online event to InternalEventV2.
   */
  buildStreamOnline(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      title?:string;
      type: 'live' | 'playlist' | 'watch_party' | 'premiere' | 'rerun' | string;
      startDate: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    if (!event) throw new Error('event_is_null');
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const startedAt = (event as any).startDate?.toISOString?.() || (event as any).startedAt?.toISOString?.() || nowIso();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'stream.online',
      version: '1',
      createdAt: startedAt,
      metadata: {
        id: event.id,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        type: event.type,
        title: event.title,
        startedAt,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.stream.online',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a stream.offline event to InternalEventV2.
   */
  buildStreamOffline(
    event: {
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    if (!event) throw new Error('event_is_null');
    const uuid = opts?.uuid || crypto.randomUUID;
    const correlationId = uuid();
    const nowIso = opts?.nowIso || (() => new Date().toISOString());

    const externalEvent: ExternalEventV1 = {
      id: `offline-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'stream.offline',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.stream.offline',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.raid event to InternalEventV2.
   * Represents when a broadcaster raids another broadcaster.
   */
  buildRaid(
    event: {
      raidingBroadcasterId: string;
      raidingBroadcasterName: string;
      raidingBroadcasterDisplayName: string;
      raidedBroadcasterId: string;
      raidedBroadcasterName: string;
      raidedBroadcasterDisplayName: string;
      viewers: number;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `raid-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.raid',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        raidingBroadcasterId: event.raidingBroadcasterId,
        raidingBroadcasterLogin: event.raidingBroadcasterName,
        raidingBroadcasterDisplayName: event.raidingBroadcasterDisplayName,
        raidedBroadcasterId: event.raidedBroadcasterId,
        raidedBroadcasterLogin: event.raidedBroadcasterName,
        raidedBroadcasterDisplayName: event.raidedBroadcasterDisplayName,
        viewers: event.viewers,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.raid',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.raidingBroadcasterName}`,
      },
      identity: {
        external: {
          id: event.raidingBroadcasterId,
          platform: 'twitch',
          displayName: event.raidingBroadcasterDisplayName,
          metadata: {
            login: event.raidingBroadcasterName,
            targetBroadcasterId: event.raidedBroadcasterId,
            targetBroadcasterLogin: event.raidedBroadcasterName,
            targetBroadcasterDisplayName: event.raidedBroadcasterDisplayName,
            viewers: event.viewers,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.raidingBroadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.subscribe event to InternalEventV2.
   * Represents a new subscription (tier 1/2/3 or Prime).
   */
  buildSubscribe(
    event: {
      userId: string;
      userName: string;
      userDisplayName: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      tier: string;
      isGift: boolean;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `subscribe-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.subscribe',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        tier: event.tier,
        isGift: event.isGift,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.subscribe',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId,
          platform: 'twitch',
          displayName: event.userDisplayName,
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            tier: event.tier,
            isGift: event.isGift,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.subscription.message event to InternalEventV2.
   * Represents a resubscription with a message.
   */
  buildSubscriptionMessage(
    event: {
      userId: string;
      userName: string;
      userDisplayName: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      tier: string;
      cumulativeMonths: number;
      streakMonths: number | null;
      durationMonths: number;
      messageText?: string;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `subscription-message-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.subscription.message',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        tier: event.tier,
        cumulativeMonths: event.cumulativeMonths,
        streakMonths: event.streakMonths,
        durationMonths: event.durationMonths,
        messageText: event.messageText,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.subscription.message',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId,
          platform: 'twitch',
          displayName: event.userDisplayName,
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            tier: event.tier,
            cumulativeMonths: event.cumulativeMonths,
            streakMonths: event.streakMonths,
            durationMonths: event.durationMonths,
          }
        }
      },
      message: event.messageText ? {
        id: correlationId,
        role: 'user' as const,
        text: event.messageText
      } : undefined,
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.subscription.gift event to InternalEventV2.
   * Represents a gifted subscription.
   */
  buildSubscriptionGift(
    event: {
      userId: string | null;
      userName: string | null;
      userDisplayName: string | null;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      tier: string;
      total: number;
      cumulativeTotal: number | null;
      isAnonymous: boolean;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `subscription-gift-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.subscription.gift',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        tier: event.tier,
        total: event.total,
        cumulativeTotal: event.cumulativeTotal,
        isAnonymous: event.isAnonymous,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.subscription.gift',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId || 'anonymous',
          platform: 'twitch',
          displayName: event.userDisplayName || 'Anonymous',
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            tier: event.tier,
            total: event.total,
            cumulativeTotal: event.cumulativeTotal,
            isAnonymous: event.isAnonymous,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.cheer event to InternalEventV2.
   * Represents a cheer (bits) in the channel.
   */
  buildCheer(
    event: {
      userId: string | null;
      userName: string | null;
      userDisplayName: string | null;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      bits: number;
      message: string;
      isAnonymous: boolean;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `cheer-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.cheer',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        bits: event.bits,
        isAnonymous: event.isAnonymous,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.cheer',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId || 'anonymous',
          platform: 'twitch',
          displayName: event.userDisplayName || 'Anonymous',
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            bits: event.bits,
            isAnonymous: event.isAnonymous,
          }
        }
      },
      message: {
        id: correlationId,
        role: 'user' as const,
        text: event.message
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.channel_points_custom_reward_redemption.add event to InternalEventV2.
   * Represents a channel points reward redemption.
   */
  buildChannelPointsRedemption(
    event: {
      id: string;
      userId: string;
      userName: string;
      userDisplayName: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      userInput: string;
      status: string;
      rewardId: string;
      rewardTitle: string;
      rewardCost: number;
      rewardPrompt: string;
      redeemedAt: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      createdAt: event.redeemedAt.toISOString(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        userInput: event.userInput,
        status: event.status,
        rewardId: event.rewardId,
        rewardTitle: event.rewardTitle,
        rewardCost: event.rewardCost,
        rewardPrompt: event.rewardPrompt,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.channel_points.redemption',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId,
          platform: 'twitch',
          displayName: event.userDisplayName,
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            rewardId: event.rewardId,
            rewardTitle: event.rewardTitle,
            rewardCost: event.rewardCost,
            rewardPrompt: event.rewardPrompt,
            userInput: event.userInput,
            status: event.status,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.hype_train.begin event to InternalEventV2.
   */
  buildHypeTrainBegin(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      level: number;
      total: number;
      progress: number;
      goal: number;
      startDate: Date;
      expiryDate: Date;
      topContributions: Array<{ userId: string; userLogin: string; userDisplayName: string; type: string; total: number }>;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.hype_train.begin',
      version: '1',
      createdAt: event.startDate.toISOString(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        level: event.level,
        total: event.total,
        progress: event.progress,
        goal: event.goal,
        startedAt: event.startDate.toISOString(),
        expiresAt: event.expiryDate.toISOString(),
        topContributions: event.topContributions,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.hype_train.begin',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
            hypeTrainId: event.id,
            level: event.level,
            total: event.total,
            progress: event.progress,
            goal: event.goal,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.hype_train.progress event to InternalEventV2.
   */
  buildHypeTrainProgress(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      level: number;
      total: number;
      progress: number;
      goal: number;
      startDate: Date;
      expiryDate: Date;
      topContributions: Array<{ userId: string; userLogin: string; userDisplayName: string; type: string; total: number }>;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.hype_train.progress',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        level: event.level,
        total: event.total,
        progress: event.progress,
        goal: event.goal,
        startedAt: event.startDate.toISOString(),
        expiresAt: event.expiryDate.toISOString(),
        topContributions: event.topContributions,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.hype_train.progress',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
            hypeTrainId: event.id,
            level: event.level,
            total: event.total,
            progress: event.progress,
            goal: event.goal,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.hype_train.end event to InternalEventV2.
   */
  buildHypeTrainEnd(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      level: number;
      total: number;
      startDate: Date;
      endDate: Date;
      cooldownEndDate: Date;
      topContributions: Array<{ userId: string; userLogin: string; userDisplayName: string; type: string; total: number }>;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.hype_train.end',
      version: '1',
      createdAt: event.endDate.toISOString(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        level: event.level,
        total: event.total,
        startedAt: event.startDate.toISOString(),
        endedAt: event.endDate.toISOString(),
        cooldownEndsAt: event.cooldownEndDate.toISOString(),
        topContributions: event.topContributions,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.hype_train.end',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
            hypeTrainId: event.id,
            level: event.level,
            total: event.total,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.poll.begin event to InternalEventV2.
   */
  buildPollBegin(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      title: string;
      choices: Array<{ id: string; title: string }>;
      bitsVotingEnabled: boolean;
      bitsPerVote: number;
      channelPointsVotingEnabled: boolean;
      channelPointsPerVote: number;
      startDate: Date;
      endDate: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.poll.begin',
      version: '1',
      createdAt: event.startDate.toISOString(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        title: event.title,
        choices: event.choices,
        bitsVotingEnabled: event.bitsVotingEnabled,
        bitsPerVote: event.bitsPerVote,
        channelPointsVotingEnabled: event.channelPointsVotingEnabled,
        channelPointsPerVote: event.channelPointsPerVote,
        startedAt: event.startDate.toISOString(),
        endsAt: event.endDate.toISOString(),
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.poll.begin',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
            pollId: event.id,
            title: event.title,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.poll.end event to InternalEventV2.
   */
  buildPollEnd(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      title: string;
      choices: Array<{ id: string; title: string; bitsVotes: number; channelPointsVotes: number; votes: number }>;
      bitsVotingEnabled: boolean;
      bitsPerVote: number;
      channelPointsVotingEnabled: boolean;
      channelPointsPerVote: number;
      status: string;
      startDate: Date;
      endDate: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.poll.end',
      version: '1',
      createdAt: event.endDate.toISOString(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        title: event.title,
        choices: event.choices,
        bitsVotingEnabled: event.bitsVotingEnabled,
        bitsPerVote: event.bitsPerVote,
        channelPointsVotingEnabled: event.channelPointsVotingEnabled,
        channelPointsPerVote: event.channelPointsPerVote,
        status: event.status,
        startedAt: event.startDate.toISOString(),
        endedAt: event.endDate.toISOString(),
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.poll.end',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
            pollId: event.id,
            title: event.title,
            status: event.status,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.prediction.begin event to InternalEventV2.
   */
  buildPredictionBegin(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      title: string;
      outcomes: Array<{ id: string; title: string; color: string }>;
      startDate: Date;
      lockDate: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.prediction.begin',
      version: '1',
      createdAt: event.startDate.toISOString(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        title: event.title,
        outcomes: event.outcomes,
        startedAt: event.startDate.toISOString(),
        locksAt: event.lockDate.toISOString(),
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.prediction.begin',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
            predictionId: event.id,
            title: event.title,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Maps a channel.prediction.end event to InternalEventV2.
   */
  buildPredictionEnd(
    event: {
      id: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      title: string;
      outcomes: Array<{ id: string; title: string; color: string; users: number; channelPoints: number; topPredictors: any[] }>;
      winningOutcomeId: string | null;
      status: string;
      startDate: Date;
      endDate: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'channel.prediction.end',
      version: '1',
      createdAt: event.endDate.toISOString(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        title: event.title,
        outcomes: event.outcomes,
        winningOutcomeId: event.winningOutcomeId,
        status: event.status,
        startedAt: event.startDate.toISOString(),
        endedAt: event.endDate.toISOString(),
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.prediction.end',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.broadcasterId,
          platform: 'twitch',
          displayName: event.broadcasterDisplayName,
          metadata: {
            login: event.broadcasterName,
            predictionId: event.id,
            title: event.title,
            status: event.status,
            winningOutcomeId: event.winningOutcomeId,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  // ============================================================================
  // TIER 2 BUILDERS - MODERATION EVENTS
  // ============================================================================

  /**
   * Build channel.ban event (ban/timeout)
   * Maps Twitch ban/timeout events to InternalEventV2
   */
  buildBan(
    event: {
      userId: string;
      userName: string;
      userDisplayName: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      moderatorId: string;
      moderatorName: string;
      moderatorDisplayName: string;
      reason: string;
      startDate: Date;
      endDate: Date | null;
      isPermanent: boolean;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `ban-${event.userId}-${event.startDate.getTime()}`,
      source: 'twitch.eventsub',
      kind: 'channel.ban',
      version: '1',
      createdAt: event.startDate.toISOString(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        moderatorId: event.moderatorId,
        moderatorLogin: event.moderatorName,
        moderatorDisplayName: event.moderatorDisplayName,
        reason: event.reason,
        isPermanent: event.isPermanent,
        startedAt: event.startDate.toISOString(),
        endsAt: event.endDate?.toISOString() || null,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.moderation.ban',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId,
          platform: 'twitch',
          displayName: event.userDisplayName,
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            moderatorId: event.moderatorId,
            moderatorLogin: event.moderatorName,
            moderatorDisplayName: event.moderatorDisplayName,
            reason: event.reason,
            isPermanent: event.isPermanent,
            duration: event.endDate ? Math.floor((event.endDate.getTime() - event.startDate.getTime()) / 1000) : null,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Build channel.unban event
   * Maps Twitch unban events to InternalEventV2
   */
  buildUnban(
    event: {
      userId: string;
      userName: string;
      userDisplayName: string;
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      moderatorId: string;
      moderatorName: string;
      moderatorDisplayName: string;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `unban-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.unban',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        moderatorId: event.moderatorId,
        moderatorLogin: event.moderatorName,
        moderatorDisplayName: event.moderatorDisplayName,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.moderation.unban',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.userId,
          platform: 'twitch',
          displayName: event.userDisplayName,
          metadata: {
            login: event.userName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            moderatorId: event.moderatorId,
            moderatorLogin: event.moderatorName,
            moderatorDisplayName: event.moderatorDisplayName,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Build channel.moderate event (v2 includes warnings)
   * Maps Twitch moderation action events to InternalEventV2
   */
  buildModerate(
    event: {
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      moderatorId: string;
      moderatorName: string;
      moderatorDisplayName: string;
      action: string;
      userId?: string;
      userName?: string;
      userDisplayName?: string;
      reason?: string;
      bannedAt?: Date;
      endsAt?: Date | null;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `moderate-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'channel.moderate',
      version: '2',
      createdAt: nowIso(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        moderatorId: event.moderatorId,
        moderatorLogin: event.moderatorName,
        moderatorDisplayName: event.moderatorDisplayName,
        action: event.action,
        userId: event.userId,
        userLogin: event.userName,
        userDisplayName: event.userDisplayName,
        reason: event.reason,
        bannedAt: event.bannedAt?.toISOString(),
        endsAt: event.endsAt?.toISOString(),
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.moderation.action',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.moderatorId,
          platform: 'twitch',
          displayName: event.moderatorDisplayName,
          metadata: {
            login: event.moderatorName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            action: event.action,
            targetUserId: event.userId,
            targetUserLogin: event.userName,
            targetUserDisplayName: event.userDisplayName,
            reason: event.reason,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  // ============================================================================
  // TIER 2 BUILDERS - CHAT EVENTS (overlap with IRC)
  // ============================================================================

  /**
   * Build channel.chat.message event
   * Maps Twitch chat message events to InternalEventV2
   * Note: Overlaps with IRC - use only if no IRC connection
   */
  buildChatMessage(
    event: {
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      chatterId: string;
      chatterName: string;
      chatterDisplayName: string;
      messageId: string;
      message: { text: string; fragments: any[] };
      color?: string;
      badges?: any[];
      messageType?: string;
      cheer?: { bits: number };
      reply?: { parentMessageId: string; parentUserId: string; parentUserName: string; parentUserLogin: string; threadMessageId: string; threadUserId: string; threadUserName: string; threadUserLogin: string };
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.messageId,
      source: 'twitch.eventsub',
      kind: 'channel.chat.message',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        chatterId: event.chatterId,
        chatterLogin: event.chatterName,
        chatterDisplayName: event.chatterDisplayName,
        messageType: event.messageType,
        color: event.color,
        badges: event.badges,
        cheer: event.cheer,
        reply: event.reply,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'chat.message.v1',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.chatterId,
          platform: 'twitch',
          displayName: event.chatterDisplayName,
          metadata: {
            login: event.chatterName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            color: event.color,
            badges: event.badges,
          }
        }
      },
      message: {
        id: event.messageId,
        role: 'user' as const,
        text: event.message.text
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }

  /**
   * Build channel.chat.message_delete event
   * Maps Twitch message delete events to InternalEventV2
   */
  buildChatMessageDelete(
    event: {
      broadcasterId: string;
      broadcasterName: string;
      broadcasterDisplayName: string;
      targetUserId: string;
      targetUserName: string;
      targetUserDisplayName: string;
      messageId: string;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const nowIso = opts?.nowIso || (() => new Date().toISOString());
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: `message-delete-${event.messageId}`,
      source: 'twitch.eventsub',
      kind: 'channel.chat.message_delete',
      version: '1',
      createdAt: nowIso(),
      metadata: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        targetUserId: event.targetUserId,
        targetUserLogin: event.targetUserName,
        targetUserDisplayName: event.targetUserDisplayName,
        messageId: event.messageId,
      },
      rawPayload: event as any,
    };

    return {
      v: '2',
      type: 'system.twitch.chat.message_delete',
      correlationId,
      traceId: uuid(),
      ingress: {
        ingressAt: nowIso(),
        source: 'ingress.twitch.eventsub',
        connector: 'twitch',
        channel: `#${event.broadcasterName}`,
      },
      identity: {
        external: {
          id: event.targetUserId,
          platform: 'twitch',
          displayName: event.targetUserDisplayName,
          metadata: {
            login: event.targetUserName,
            broadcasterId: event.broadcasterId,
            broadcasterLogin: event.broadcasterName,
            broadcasterDisplayName: event.broadcasterDisplayName,
            deletedMessageId: event.messageId,
          }
        }
      },
      egress: { destination: opts?.finalizationDestination || '', connector: 'twitch', channel: `#${event.broadcasterName}` },
      externalEvent,
      routing: {
        stage: 'initial',
        slip: [],
        history: [],
      }
    };
  }
}
