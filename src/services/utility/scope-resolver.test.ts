/**
 * ScopeResolver Unit Tests
 * Sprint 27: Platform Utilities - Counters & Bidding
 *
 * Tests all scope resolution paths and error cases
 */

import { ScopeResolver } from './scope-resolver';
import type { InternalEventV2 } from '../../types';
import { logger as globalLogger } from '../../common/logging';

// Mock logger for tests
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('ScopeResolver', () => {
  let resolver: ScopeResolver;

  beforeEach(() => {
    resolver = new ScopeResolver(mockLogger);
    jest.clearAllMocks();
  });

  describe('Explicit scope parameters (Priority 1)', () => {
    it('should resolve explicit global scope', () => {
      const result = resolver.resolve({
        scopeType: 'global',
        scopeValue: 'global',
      });

      expect(result).toEqual({
        scopeType: 'global',
        scopeValue: 'global',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'scope.resolve.explicit',
        { scopeType: 'global', scopeValue: 'global' }
      );
    });

    it('should resolve explicit stream scope', () => {
      const result = resolver.resolve({
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(result).toEqual({
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });
    });

    it('should resolve explicit user scope', () => {
      const result = resolver.resolve({
        scopeType: 'user',
        scopeValue: 'user123',
      });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'user123',
      });
    });

    it('should resolve explicit session scope', () => {
      const result = resolver.resolve({
        scopeType: 'session',
        scopeValue: 'session456',
      });

      expect(result).toEqual({
        scopeType: 'session',
        scopeValue: 'session456',
      });
    });

    it('should resolve explicit custom scope', () => {
      const result = resolver.resolve({
        scopeType: 'custom',
        scopeValue: 'custom-scope-123',
      });

      expect(result).toEqual({
        scopeType: 'custom',
        scopeValue: 'custom-scope-123',
      });
    });

    it('should throw error for invalid scope type', () => {
      expect(() => {
        resolver.resolve({
          scopeType: 'invalid' as any,
          scopeValue: 'test',
        });
      }).toThrow('Invalid scope type: invalid');
    });
  });

  describe('Explicit type with inferred value (Priority 2)', () => {
    it('should infer stream scope value from event.ingress.channel', () => {
      const event = {
        ingress: { channel: 'bitbrat' },
      } as InternalEventV2;

      const result = resolver.resolve({
        scopeType: 'stream',
        event,
      });

      expect(result).toEqual({
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'scope.resolve.explicit_type_inferred_value',
        { scopeType: 'stream', scopeValue: 'bitbrat' }
      );
    });

    it('should infer user scope value from event.identity.user.id', () => {
      const event = {
        identity: {
          user: { id: 'user123' },
        },
      } as InternalEventV2;

      const result = resolver.resolve({
        scopeType: 'user',
        event,
      });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'user123',
      });
    });

    it('should fallback to identity.external.id for user scope', () => {
      const event = {
        identity: {
          external: { id: 'external456', platform: 'twitch' },
        },
      } as InternalEventV2;

      const result = resolver.resolve({
        scopeType: 'user',
        event,
      });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'external456',
      });
    });

    it('should throw error when stream scope value cannot be inferred', () => {
      const event = {
        ingress: {},
      } as InternalEventV2;

      expect(() => {
        resolver.resolve({
          scopeType: 'stream',
          event,
        });
      }).toThrow('Cannot infer stream scope value: event.ingress.channel is missing');
    });

    it('should throw error when user scope value cannot be inferred', () => {
      const event = {
        identity: {},
      } as InternalEventV2;

      expect(() => {
        resolver.resolve({
          scopeType: 'user',
          event,
        });
      }).toThrow('Cannot infer user scope value');
    });

    it('should throw error for session scope (cannot infer)', () => {
      const event = {} as InternalEventV2;

      expect(() => {
        resolver.resolve({
          scopeType: 'session',
          event,
        });
      }).toThrow('Cannot infer session scope value');
    });

    it('should throw error for custom scope (cannot infer)', () => {
      const event = {} as InternalEventV2;

      expect(() => {
        resolver.resolve({
          scopeType: 'custom',
          event,
        });
      }).toThrow('Cannot infer custom scope value');
    });

    it('should infer global scope value', () => {
      const event = {} as InternalEventV2;

      const result = resolver.resolve({
        scopeType: 'global',
        event,
      });

      expect(result).toEqual({
        scopeType: 'global',
        scopeValue: 'global',
      });
    });
  });

  describe('Auto-infer from event (Priority 3)', () => {
    it('should infer stream scope from event.ingress.channel', () => {
      const event = {
        ingress: { channel: 'bitbrat', connector: 'twitch' },
        identity: { external: { id: 'user123', platform: 'twitch' } },
      } as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'stream',
        scopeValue: 'bitbrat',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'scope.resolve.auto_inferred',
        { scopeType: 'stream', scopeValue: 'bitbrat' }
      );
    });

    it('should infer user scope when channel not available', () => {
      const event = {
        ingress: { connector: 'twitch' },
        identity: { user: { id: 'user123' } },
      } as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'user123',
      });
    });

    it('should use identity.external.id when identity.user.id not available', () => {
      const event = {
        ingress: { connector: 'twitch' },
        identity: { external: { id: 'external456', platform: 'twitch' } },
      } as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'external456',
      });
    });

    it('should fallback to global scope when no context available', () => {
      const event = {
        ingress: { connector: 'system' },
        identity: {},
      } as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'global',
        scopeValue: 'global',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'scope.infer_from_event.fallback_global',
        { reason: 'No channel or user ID found in event' }
      );
    });
  });

  describe('Default to global (Priority 4)', () => {
    it('should default to global scope when no params provided', () => {
      const result = resolver.resolve({});

      expect(result).toEqual({
        scopeType: 'global',
        scopeValue: 'global',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('scope.resolve.default_global');
    });
  });

  describe('Helper methods', () => {
    describe('buildId', () => {
      it('should build ID from scope and name', () => {
        const scope = { scopeType: 'stream' as const, scopeValue: 'bitbrat' };
        const id = resolver.buildId(scope, 'deaths');

        expect(id).toBe('stream:bitbrat:deaths');
      });

      it('should build ID for global scope', () => {
        const scope = { scopeType: 'global' as const, scopeValue: 'global' };
        const id = resolver.buildId(scope, 'total_messages');

        expect(id).toBe('global:global:total_messages');
      });

      it('should build ID for user scope', () => {
        const scope = { scopeType: 'user' as const, scopeValue: 'user123' };
        const id = resolver.buildId(scope, 'points');

        expect(id).toBe('user:user123:points');
      });
    });

    describe('buildKey', () => {
      it('should build Redis key with prefix', () => {
        const scope = { scopeType: 'stream' as const, scopeValue: 'bitbrat' };
        const key = resolver.buildKey('counter', scope, 'deaths');

        expect(key).toBe('counter:stream:bitbrat:deaths');
      });

      it('should build bid session key', () => {
        const scope = { scopeType: 'stream' as const, scopeValue: 'bitbrat' };
        const key = resolver.buildKey('bid:session', scope, 'boss_hp');

        expect(key).toBe('bid:session:stream:bitbrat:boss_hp');
      });

      it('should handle global scope keys', () => {
        const scope = { scopeType: 'global' as const, scopeValue: 'global' };
        const key = resolver.buildKey('counter', scope, 'system_uptime');

        expect(key).toBe('counter:global:global:system_uptime');
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle event with only ingress.channel', () => {
      const event = {
        ingress: { channel: 'test-channel' },
      } as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'stream',
        scopeValue: 'test-channel',
      });
    });

    it('should handle event with only identity.user.id', () => {
      const event = {
        identity: { user: { id: 'user999' } },
      } as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'user999',
      });
    });

    it('should handle empty event object', () => {
      const event = {} as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'global',
        scopeValue: 'global',
      });
    });

    it('should prioritize explicit params over event', () => {
      const event = {
        ingress: { channel: 'bitbrat' },
      } as InternalEventV2;

      const result = resolver.resolve({
        scopeType: 'user',
        scopeValue: 'explicit-user',
        event, // Should be ignored
      });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'explicit-user',
      });
    });

    it('should prioritize identity.user.id over identity.external.id', () => {
      const event = {
        identity: {
          user: { id: 'internal-user' },
          external: { id: 'external-user', platform: 'twitch' },
        },
      } as InternalEventV2;

      const result = resolver.resolve({ event });

      expect(result).toEqual({
        scopeType: 'user',
        scopeValue: 'internal-user',
      });
    });
  });
});
