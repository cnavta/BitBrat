/**
 * Unit tests for condition-evaluator.ts
 */

import { describe, it, expect } from '@jest/globals';
import { evaluateConditions } from '../condition-evaluator.js';
import type { InternalEventV2 } from '../../../types/events.js';
import type { ReflexCondition } from '../../../types/reflex.js';

describe('Condition Evaluator', () => {
  const baseEvent: InternalEventV2 = {
    v: '2',
    type: 'twitch.chat.message',
    correlationId: 'test-123',
    ingress: {
      ingressAt: '2026-07-04T12:00:00Z',
      source: 'twitch-ingress',
      connector: 'twitch' as any,
      channel: '#testchannel',
    },
    message: {
      id: 'msg-123',
      role: 'user',
      text: 'hello world',
    },
    identity: {
      user: {
        id: 'user123',
        displayName: 'TestUser',
      },
      external: {
        id: 'user123',
        platform: 'twitch',
        displayName: 'TestUser',
      },
    },
    routing: {
      stage: 'analysis' as any,
      slip: [],
      history: [],
    },
    egress: {
      destination: 'twitch',
      connector: 'twitch' as any,
    },
  };

  describe('No conditions (undefined)', () => {
    it('should return true when no conditions specified', () => {
      expect(evaluateConditions(baseEvent)).toBe(true);
      expect(evaluateConditions(baseEvent, undefined)).toBe(true);
    });
  });

  describe('eventTypes condition', () => {
    it('should match allowed event types', () => {
      const conditions: ReflexCondition = {
        eventTypes: ['twitch.chat.message'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(true);
    });

    it('should match when event type is in list', () => {
      const conditions: ReflexCondition = {
        eventTypes: ['discord.message', 'twitch.chat.message', 'kick.chat.message'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(true);
    });

    it('should not match disallowed event types', () => {
      const conditions: ReflexCondition = {
        eventTypes: ['discord.message'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(false);
    });

    it('should return true when eventTypes array is empty', () => {
      const conditions: ReflexCondition = {
        eventTypes: [],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(true);
    });
  });

  describe('channels condition', () => {
    it('should match allowed channels', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        ingress: {
          ...baseEvent.ingress,
          channel: 'channel-123',
        },
      };
      const conditions: ReflexCondition = {
        channels: ['channel-123'],
      };
      expect(evaluateConditions(event, conditions)).toBe(true);
    });

    it('should not match disallowed channels', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
      };
      const conditions: ReflexCondition = {
        channels: ['channel-456'],
      };
      expect(evaluateConditions(event, conditions)).toBe(false);
    });

    it('should not match when channel is missing', () => {
      const conditions: ReflexCondition = {
        channels: ['channel-123'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(false);
    });
  });

  describe('platforms condition', () => {
    it('should match allowed platforms', () => {
      const conditions: ReflexCondition = {
        platforms: ['twitch'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(true);
    });

    it('should match when platform is in list', () => {
      const conditions: ReflexCondition = {
        platforms: ['discord', 'twitch', 'kick'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(true);
    });

    it('should not match disallowed platforms', () => {
      const conditions: ReflexCondition = {
        platforms: ['discord'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(false);
    });
  });

  describe('userRoles condition', () => {
    it('should match when user has required role', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
            roles: ['moderator', 'subscriber'],
          },
        },
      };
      const conditions: ReflexCondition = {
        userRoles: ['moderator'],
      };
      expect(evaluateConditions(event, conditions)).toBe(true);
    });

    it('should match when user has any required role', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
            roles: ['subscriber'],
          },
        },
      };
      const conditions: ReflexCondition = {
        userRoles: ['moderator', 'subscriber'],
      };
      expect(evaluateConditions(event, conditions)).toBe(true);
    });

    it('should not match when user lacks required roles', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
            roles: ['viewer'],
          },
        },
      };
      const conditions: ReflexCondition = {
        userRoles: ['moderator'],
      };
      expect(evaluateConditions(event, conditions)).toBe(false);
    });

    it('should not match when user has no roles', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
          },
        },
      };
      const conditions: ReflexCondition = {
        userRoles: ['moderator'],
      };
      expect(evaluateConditions(event, conditions)).toBe(false);
    });

    it('should not match when identity has no user', () => {
      const conditions: ReflexCondition = {
        userRoles: ['moderator'],
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(false);
    });
  });

  describe('minAuthLevel condition', () => {
    it('should match anonymous events at level 0', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          external: {
            id: 'anon',
            platform: 'web',
          },
        } as any,
      };
      const conditions: ReflexCondition = {
        minAuthLevel: 0,
      };
      expect(evaluateConditions(event, conditions)).toBe(true);
    });

    it('should match external identity at level 1', () => {
      const conditions: ReflexCondition = {
        minAuthLevel: 1,
      };
      expect(evaluateConditions(baseEvent, conditions)).toBe(true);
    });

    it('should match matched user at level 2', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
          },
        },
      };
      const conditions: ReflexCondition = {
        minAuthLevel: 2,
      };
      expect(evaluateConditions(event, conditions)).toBe(true);
    });

    it('should match user with roles at level 3', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
            roles: ['moderator'],
          },
        },
      };
      const conditions: ReflexCondition = {
        minAuthLevel: 3,
      };
      expect(evaluateConditions(event, conditions)).toBe(true);
    });

    it('should not match when auth level too low', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          external: {
            id: 'user123',
            platform: 'twitch',
            displayName: 'TestUser',
          },
          // No user field = level 1 (external only)
        },
      };
      const conditions: ReflexCondition = {
        minAuthLevel: 2,
      };
      // Event only has external identity, not user (level 1)
      expect(evaluateConditions(event, conditions)).toBe(false);
    });
  });

  describe('AND logic (multiple conditions)', () => {
    it('should match when all conditions pass', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        ingress: {
          ...baseEvent.ingress,
          channel: 'channel-123',
        },
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
            roles: ['moderator'],
          },
        },
      };
      const conditions: ReflexCondition = {
        eventTypes: ['twitch.chat.message'],
        channels: ['channel-123'],
        platforms: ['twitch'],
        userRoles: ['moderator'],
        minAuthLevel: 3,
      };
      expect(evaluateConditions(event, conditions)).toBe(true);
    });

    it('should not match when one condition fails', () => {
      const event: InternalEventV2 = {
        ...baseEvent,
        identity: {
          ...baseEvent.identity!,
          user: {
            id: 'user-123',
            displayName: 'TestUser',
            roles: ['moderator'],
          },
        },
      };
      const conditions: ReflexCondition = {
        eventTypes: ['twitch.chat.message'],
        channels: ['channel-456'], // Wrong channel
        platforms: ['twitch'],
        userRoles: ['moderator'],
        minAuthLevel: 3,
      };
      expect(evaluateConditions(event, conditions)).toBe(false);
    });
  });
});
