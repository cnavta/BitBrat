/**
 * Unit tests for field-accessor.ts
 */

import { describe, it, expect } from '@jest/globals';
import { getFieldValue } from '../field-accessor.js';

describe('Field Accessor', () => {
  const testData = {
    user: {
      id: 'user-123',
      name: 'JohnDoe',
      profile: {
        email: 'john@example.com',
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
    },
    message: {
      text: 'hello world',
      timestamp: '2026-07-04T12:00:00Z',
    },
    count: 42,
    enabled: true,
    tags: ['tag1', 'tag2', 'tag3'],
    nullValue: null,
  };

  describe('Simple field access', () => {
    it('should access top-level string fields', () => {
      const value = getFieldValue({ name: 'Test' }, 'name');
      expect(value).toBe('Test');
    });

    it('should access top-level number fields', () => {
      const value = getFieldValue(testData, 'count');
      expect(value).toBe(42);
    });

    it('should access top-level boolean fields', () => {
      const value = getFieldValue(testData, 'enabled');
      expect(value).toBe(true);
    });

    it('should access top-level array fields', () => {
      const value = getFieldValue(testData, 'tags');
      expect(value).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should access top-level object fields', () => {
      const value = getFieldValue(testData, 'user');
      expect(value).toEqual(testData.user);
    });
  });

  describe('Nested field access', () => {
    it('should access nested fields with dot notation', () => {
      const value = getFieldValue(testData, 'user.name');
      expect(value).toBe('JohnDoe');
    });

    it('should access deeply nested fields', () => {
      const value = getFieldValue(testData, 'user.profile.email');
      expect(value).toBe('john@example.com');
    });

    it('should access very deeply nested fields', () => {
      const value = getFieldValue(testData, 'user.profile.settings.theme');
      expect(value).toBe('dark');
    });

    it('should access nested boolean fields', () => {
      const value = getFieldValue(testData, 'user.profile.settings.notifications');
      expect(value).toBe(true);
    });
  });

  describe('Missing fields', () => {
    it('should return undefined for non-existent top-level field', () => {
      const value = getFieldValue(testData, 'missing');
      expect(value).toBeUndefined();
    });

    it('should return undefined for non-existent nested field', () => {
      const value = getFieldValue(testData, 'user.missing');
      expect(value).toBeUndefined();
    });

    it('should return undefined for deeply non-existent field', () => {
      const value = getFieldValue(testData, 'user.profile.missing.field');
      expect(value).toBeUndefined();
    });

    it('should return undefined when accessing property of non-object', () => {
      const value = getFieldValue(testData, 'count.something');
      expect(value).toBeUndefined();
    });

    it('should return undefined when accessing property of null', () => {
      const value = getFieldValue(testData, 'nullValue.something');
      expect(value).toBeUndefined();
    });
  });

  describe('Null and undefined handling', () => {
    it('should handle null values', () => {
      const value = getFieldValue(testData, 'nullValue');
      expect(value).toBeNull();
    });

    it('should return undefined for undefined object', () => {
      const value = getFieldValue(undefined, 'field');
      expect(value).toBeUndefined();
    });

    it('should return undefined for null object', () => {
      const value = getFieldValue(null, 'field');
      expect(value).toBeUndefined();
    });

    it('should handle object with undefined field', () => {
      const data = { defined: 'value', undefined: undefined };
      const value = getFieldValue(data, 'undefined');
      expect(value).toBeUndefined();
    });
  });

  describe('Array access', () => {
    it('should access array elements by index', () => {
      const value = getFieldValue(testData, 'tags.0');
      expect(value).toBe('tag1');
    });

    it('should access nested array elements', () => {
      const data = {
        nested: {
          items: ['a', 'b', 'c'],
        },
      };
      const value = getFieldValue(data, 'nested.items.1');
      expect(value).toBe('b');
    });

    it('should return undefined for out-of-bounds array index', () => {
      const value = getFieldValue(testData, 'tags.10');
      expect(value).toBeUndefined();
    });
  });

  describe('Special characters in field names', () => {
    it('should handle fields with underscores', () => {
      const data = { user_name: 'test' };
      const value = getFieldValue(data, 'user_name');
      expect(value).toBe('test');
    });

    it('should handle fields with numbers', () => {
      const data = { field123: 'value' };
      const value = getFieldValue(data, 'field123');
      expect(value).toBe('value');
    });

    it('should handle nested fields with special characters', () => {
      const data = {
        user_profile: {
          display_name: 'Test User',
        },
      };
      const value = getFieldValue(data, 'user_profile.display_name');
      expect(value).toBe('Test User');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty path', () => {
      const value = getFieldValue(testData, '');
      expect(value).toBeUndefined();
    });

    it('should handle path with only dots', () => {
      const value = getFieldValue(testData, '...');
      expect(value).toBeUndefined();
    });

    it('should handle path with trailing dot', () => {
      const value = getFieldValue(testData, 'user.name.');
      expect(value).toBeUndefined();
    });

    it('should handle path with leading dot', () => {
      const value = getFieldValue(testData, '.user.name');
      expect(value).toBeUndefined();
    });

    it('should handle very long paths', () => {
      const data = { a: { b: { c: { d: { e: { f: { g: 'value' } } } } } } };
      const value = getFieldValue(data, 'a.b.c.d.e.f.g');
      expect(value).toBe('value');
    });

    it('should handle empty object', () => {
      const value = getFieldValue({}, 'field');
      expect(value).toBeUndefined();
    });

    it('should handle primitive values as objects', () => {
      const value = getFieldValue(42 as any, 'field');
      expect(value).toBeUndefined();
    });

    it('should handle string as object', () => {
      const value = getFieldValue('string' as any, 'field');
      expect(value).toBeUndefined();
    });
  });

  describe('Real-world scenarios', () => {
    it('should access event identity user displayName', () => {
      const event = {
        identity: {
          user: {
            id: 'user-123',
            displayName: 'TestUser',
          },
        },
      };
      const value = getFieldValue(event, 'identity.user.displayName');
      expect(value).toBe('TestUser');
    });

    it('should access message text from event', () => {
      const event = {
        message: {
          text: 'hello world',
        },
      };
      const value = getFieldValue(event, 'message.text');
      expect(value).toBe('hello world');
    });

    it('should access platform id from identity', () => {
      const event = {
        identity: {
          platform: {
            id: 'twitch',
            name: 'Twitch',
          },
        },
      };
      const value = getFieldValue(event, 'identity.platform.id');
      expect(value).toBe('twitch');
    });

    it('should handle missing optional fields gracefully', () => {
      const event = {
        identity: {
          externalUser: {
            id: 'external-123',
          },
        },
      };
      // Accessing user when only externalUser exists
      const value = getFieldValue(event, 'identity.user.displayName');
      expect(value).toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should handle many field accesses efficiently', () => {
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        getFieldValue(testData, 'user.profile.settings.theme');
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // 10,000 accesses in <100ms
    });

    it('should handle many top-level accesses efficiently', () => {
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        getFieldValue(testData, 'count');
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50); // Simple accesses should be very fast
    });
  });
});
