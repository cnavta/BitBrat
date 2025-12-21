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
      payload: {
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
      v: '1',
      source: 'ingress.twitch.eventsub',
      correlationId,
      traceId: uuid(),
      routingSlip: [],
      type: 'twitch.eventsub.v1',
      channel: `#${event.broadcasterName}`,
      userId: event.userId,
      externalEvent,
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
      payload: {
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
      v: '1',
      source: 'ingress.twitch.eventsub',
      correlationId,
      traceId: uuid(),
      routingSlip: [],
      type: 'twitch.eventsub.v1',
      channel: `#${event.broadcasterName}`,
      userId: event.broadcasterId, // In update events, the "actor" is the broadcaster
      externalEvent,
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
      type: 'live' | 'playlist' | 'watch_party' | 'premiere' | 'rerun' | string;
      startedAt: Date;
    },
    opts?: EnvelopeBuilderOptions
  ): InternalEventV2 {
    const uuid = opts?.uuid || crypto.randomUUID;
    const correlationId = uuid();

    const externalEvent: ExternalEventV1 = {
      id: event.id,
      source: 'twitch.eventsub',
      kind: 'stream.online',
      version: '1',
      createdAt: event.startedAt.toISOString(),
      payload: {
        id: event.id,
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
        type: event.type,
        startedAt: event.startedAt.toISOString(),
      },
      rawPayload: event as any,
    };

    return {
      v: '1',
      source: 'ingress.twitch.eventsub',
      correlationId,
      traceId: uuid(),
      routingSlip: [],
      type: 'system.stream.online',
      channel: `#${event.broadcasterName}`,
      userId: event.broadcasterId,
      externalEvent,
      payload: externalEvent.payload, // Flattened for easier access
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
    const uuid = opts?.uuid || crypto.randomUUID;
    const correlationId = uuid();
    const nowIso = opts?.nowIso || (() => new Date().toISOString());

    const externalEvent: ExternalEventV1 = {
      id: `offline-${correlationId}`,
      source: 'twitch.eventsub',
      kind: 'stream.offline',
      version: '1',
      createdAt: nowIso(),
      payload: {
        broadcasterId: event.broadcasterId,
        broadcasterLogin: event.broadcasterName,
        broadcasterDisplayName: event.broadcasterDisplayName,
      },
      rawPayload: event as any,
    };

    return {
      v: '1',
      source: 'ingress.twitch.eventsub',
      correlationId,
      traceId: uuid(),
      routingSlip: [],
      type: 'system.stream.offline',
      channel: `#${event.broadcasterName}`,
      userId: event.broadcasterId,
      externalEvent,
      payload: externalEvent.payload,
    };
  }
}
