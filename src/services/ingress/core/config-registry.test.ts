/**
 * Config Registry Tests
 *
 * Comprehensive test suite for YAML-based event registry.
 *
 * Sprint 13: DM Capability Implementation (EP-01 DX Foundation)
 * Acceptance Criteria: 85%+ unit test coverage
 *
 * @since Sprint 13
 */

import { ConfigRegistry, type EventDefinition, type PlatformEventMapping } from './config-registry';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

describe('ConfigRegistry', () => {
  let testConfigDir: string;
  let registry: ConfigRegistry;

  beforeEach(async () => {
    // Create temporary config directory
    testConfigDir = path.join(tmpdir(), `config-registry-test-${randomUUID()}`);
    await fs.mkdir(testConfigDir, { recursive: true });
    await fs.mkdir(path.join(testConfigDir, 'events'), { recursive: true });
    await fs.mkdir(path.join(testConfigDir, 'platforms'), { recursive: true });

    registry = new ConfigRegistry({
      configPath: testConfigDir,
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    });
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(testConfigDir, { recursive: true, force: true });
  });

  describe('Event Definition Loading', () => {
    it('should load valid event definition from YAML', async () => {
      const eventDef = {
        type: 'dm.message.v1',
        description: 'Direct message event',
        version: 1,
        category: 'bidirectional',
      };

      await fs.writeFile(
        path.join(testConfigDir, 'events', 'dm-message.yaml'),
        `type: dm.message.v1
description: Direct message event
version: 1
category: bidirectional`
      );

      await registry.load();

      const loaded = registry.findByType('dm.message.v1');
      expect(loaded).toMatchObject(eventDef);
    });

    it('should load multiple event definitions', async () => {
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'dm-message.yaml'),
        `type: dm.message.v1
description: Direct message
version: 1
category: bidirectional`
      );

      await fs.writeFile(
        path.join(testConfigDir, 'events', 'chat-message.yaml'),
        `type: chat.message.v1
description: Channel message
version: 1
category: bidirectional`
      );

      await registry.load();

      expect(registry.findByType('dm.message.v1')).toBeDefined();
      expect(registry.findByType('chat.message.v1')).toBeDefined();
    });

    it('should handle missing events directory gracefully', async () => {
      await fs.rm(path.join(testConfigDir, 'events'), { recursive: true });

      await expect(registry.load()).resolves.not.toThrow();

      const stats = registry.getStats();
      expect(stats.eventCount).toBe(0);
    });

    it('should throw error for event definition missing required fields', async () => {
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'invalid.yaml'),
        `description: Missing type field`
      );

      await expect(registry.load()).rejects.toThrow('missing required fields');
    });

    it('should support deprecated flag', async () => {
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'legacy.yaml'),
        `type: legacy.event.v1
description: Deprecated event
version: 1
category: ingress
deprecated: true`
      );

      await registry.load();

      const loaded = registry.findByType('legacy.event.v1');
      expect(loaded?.deprecated).toBe(true);
    });

    it('should support metadata field', async () => {
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'meta-event.yaml'),
        `type: meta.event.v1
description: Event with metadata
version: 1
category: ingress
metadata:
  createdBy: john_doe
  createdAt: "2026-08-14"`
      );

      await registry.load();

      const loaded = registry.findByType('meta.event.v1');
      expect(loaded?.metadata).toEqual({
        createdBy: 'john_doe',
        createdAt: '2026-08-14',
      });
    });
  });

  describe('Platform Mapping Loading', () => {
    it('should load platform mapping from YAML', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'discord'), { recursive: true });
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'message-create.yaml'),
        `platformEvent: MESSAGE_CREATE
internalEventType: chat.message.v1
fieldMapping:
  userId: author.id
  channelId: channel_id
  messageText: content`
      );

      await registry.load();

      const mapping = registry.findByPlatformEvent('discord', 'MESSAGE_CREATE');
      expect(mapping).toMatchObject({
        platform: 'discord',
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
      });
      expect(mapping?.fieldMapping).toEqual({
        userId: 'author.id',
        channelId: 'channel_id',
        messageText: 'content',
      });
    });

    it('should load multiple platform mappings', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'discord'), { recursive: true });
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'message-create.yaml'),
        `platformEvent: MESSAGE_CREATE
internalEventType: chat.message.v1
fieldMapping:
  userId: author.id
  channelId: channel_id`
      );

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'typing-start.yaml'),
        `platformEvent: TYPING_START
internalEventType: typing.start.v1
fieldMapping:
  userId: user_id
  channelId: channel_id`
      );

      await registry.load();

      const mappings = registry.getPlatformMappings('discord');
      expect(mappings).toHaveLength(2);
    });

    it('should handle missing platforms directory gracefully', async () => {
      await fs.rm(path.join(testConfigDir, 'platforms'), { recursive: true });

      await expect(registry.load()).resolves.not.toThrow();

      const stats = registry.getStats();
      expect(stats.platformCount).toBe(0);
    });

    it('should throw error for platform mapping missing required fields', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'discord'), { recursive: true });
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'invalid.yaml'),
        `platformEvent: MESSAGE_CREATE`
      );

      await expect(registry.load()).rejects.toThrow('missing required fields');
    });
  });

  describe('JSONLogic Filter Support', () => {
    it('should compile and evaluate JSONLogic filter', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'discord'), { recursive: true });

      // Regular message (no filter)
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'chat-message.yaml'),
        `platformEvent: MESSAGE_CREATE
internalEventType: chat.message.v1
priority: 0
fieldMapping:
  userId: author.id
  channelId: channel_id`
      );

      // DM variant (with filter for channel type 1)
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'dm-message.yaml'),
        `platformEvent: MESSAGE_CREATE
internalEventType: dm.message.v1
priority: 10
filter:
  "==": [{ "var": "channel.type" }, 1]
fieldMapping:
  userId: author.id
  channelId: channel_id`
      );

      await registry.load();

      // DM event (channel type 1)
      const dmEvent = {
        channel: { type: 1, id: 'C123' },
        author: { id: 'U123' },
      };

      const dmMapping = registry.findByPlatformEvent('discord', 'MESSAGE_CREATE', dmEvent);
      expect(dmMapping?.internalEventType).toBe('dm.message.v1');

      // Regular message (channel type 0)
      const chatEvent = {
        channel: { type: 0, id: 'C456' },
        author: { id: 'U456' },
      };

      const chatMapping = registry.findByPlatformEvent('discord', 'MESSAGE_CREATE', chatEvent);
      expect(chatMapping?.internalEventType).toBe('chat.message.v1');
    });

    it('should handle complex JSONLogic filters', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'slack'), { recursive: true });

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'slack', 'dm-message.yaml'),
        `platformEvent: message
internalEventType: dm.message.v1
filter:
  "and": [
    { "==": [{ "var": "event.channel_type" }, "im"] },
    { "!": [{ "var": "event.bot_id" }] }
  ]
fieldMapping:
  eventWrapper: event
  userId: user
  channelId: channel`
      );

      await registry.load();

      // DM from user
      const dmEvent = {
        event: {
          channel_type: 'im',
          user: 'U123',
          channel: 'D123',
        },
      };

      const mapping = registry.findByPlatformEvent('slack', 'message', dmEvent);
      expect(mapping?.internalEventType).toBe('dm.message.v1');

      // DM from bot (should not match)
      const botEvent = {
        event: {
          channel_type: 'im',
          bot_id: 'B123',
          channel: 'D123',
        },
      };

      const botMapping = registry.findByPlatformEvent('slack', 'message', botEvent);
      expect(botMapping).toBeUndefined();
    });

    it('should return undefined if filter does not match', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'discord'), { recursive: true });

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'dm-only.yaml'),
        `platformEvent: MESSAGE_CREATE
internalEventType: dm.message.v1
filter:
  "==": [{ "var": "channel.type" }, 1]
fieldMapping:
  userId: author.id
  channelId: channel_id`
      );

      await registry.load();

      // Non-DM event (filter won't match)
      const chatEvent = {
        channel: { type: 0, id: 'C456' },
        author: { id: 'U456' },
      };

      const mapping = registry.findByPlatformEvent('discord', 'MESSAGE_CREATE', chatEvent);
      expect(mapping).toBeUndefined();
    });
  });

  describe('Priority Handling', () => {
    it('should return highest priority mapping when multiple match', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'test'), { recursive: true });

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'test', 'low-priority.yaml'),
        `platformEvent: TEST_EVENT
internalEventType: low.priority.v1
priority: 5
fieldMapping:
  userId: user
  channelId: channel`
      );

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'test', 'high-priority.yaml'),
        `platformEvent: TEST_EVENT
internalEventType: high.priority.v1
priority: 10
fieldMapping:
  userId: user
  channelId: channel`
      );

      await registry.load();

      const mapping = registry.findByPlatformEvent('test', 'TEST_EVENT');
      expect(mapping?.internalEventType).toBe('high.priority.v1');
    });

    it('should sort mappings by priority descending', async () => {
      await fs.mkdir(path.join(testConfigDir, 'platforms', 'test'), { recursive: true });

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'test', 'p5.yaml'),
        `platformEvent: EVENT_A
internalEventType: type.a.v1
priority: 5
fieldMapping:
  userId: user
  channelId: channel`
      );

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'test', 'p10.yaml'),
        `platformEvent: EVENT_B
internalEventType: type.b.v1
priority: 10
fieldMapping:
  userId: user
  channelId: channel`
      );

      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'test', 'p0.yaml'),
        `platformEvent: EVENT_C
internalEventType: type.c.v1
priority: 0
fieldMapping:
  userId: user
  channelId: channel`
      );

      await registry.load();

      const mappings = registry.getPlatformMappings('test');

      expect(mappings[0].priority).toBe(10);
      expect(mappings[1].priority).toBe(5);
      expect(mappings[2].priority).toBe(0);
    });
  });

  describe('Query Methods', () => {
    beforeEach(async () => {
      // Set up test data
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'dm-message.yaml'),
        `type: dm.message.v1
description: DM event
version: 1
category: bidirectional`
      );

      await fs.writeFile(
        path.join(testConfigDir, 'events', 'chat-message.yaml'),
        `type: chat.message.v1
description: Chat event
version: 1
category: bidirectional`
      );

      await fs.mkdir(path.join(testConfigDir, 'platforms', 'discord'), { recursive: true });
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'discord', 'dm.yaml'),
        `platformEvent: MESSAGE_CREATE
internalEventType: dm.message.v1
fieldMapping:
  userId: author.id
  channelId: channel_id`
      );

      await fs.mkdir(path.join(testConfigDir, 'platforms', 'slack'), { recursive: true });
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'slack', 'dm.yaml'),
        `platformEvent: message
internalEventType: dm.message.v1
fieldMapping:
  userId: user
  channelId: channel`
      );

      await registry.load();
    });

    it('should find event by type', () => {
      const def = registry.findByType('dm.message.v1');
      expect(def).toBeDefined();
      expect(def?.type).toBe('dm.message.v1');
    });

    it('should return undefined for unknown event type', () => {
      const def = registry.findByType('unknown.event.v1');
      expect(def).toBeUndefined();
    });

    it('should find platform mapping by platform and event name', () => {
      const mapping = registry.findByPlatformEvent('discord', 'MESSAGE_CREATE');
      expect(mapping).toBeDefined();
      expect(mapping?.platform).toBe('discord');
    });

    it('should return undefined for unknown platform', () => {
      const mapping = registry.findByPlatformEvent('unknown', 'EVENT');
      expect(mapping).toBeUndefined();
    });

    it('should return undefined for unknown platform event', () => {
      const mapping = registry.findByPlatformEvent('discord', 'UNKNOWN_EVENT');
      expect(mapping).toBeUndefined();
    });

    it('should list platforms supporting an event type', () => {
      const platforms = registry.listPlatforms('dm.message.v1');
      expect(platforms).toContain('discord');
      expect(platforms).toContain('slack');
      expect(platforms).toHaveLength(2);
    });

    it('should return empty array for event type with no platform support', () => {
      const platforms = registry.listPlatforms('chat.message.v1');
      expect(platforms).toEqual([]);
    });

    it('should list all events', () => {
      const events = registry.listEvents();
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.type)).toContain('dm.message.v1');
      expect(events.map((e) => e.type)).toContain('chat.message.v1');
    });

    it('should list events with filter', () => {
      const bidirectional = registry.listEvents((e) => e.category === 'bidirectional');
      expect(bidirectional).toHaveLength(2);
    });

    it('should get platform mappings', () => {
      const mappings = registry.getPlatformMappings('discord');
      expect(mappings).toHaveLength(1);
      expect(mappings[0].platformEvent).toBe('MESSAGE_CREATE');
    });

    it('should return empty array for unknown platform mappings', () => {
      const mappings = registry.getPlatformMappings('unknown');
      expect(mappings).toEqual([]);
    });
  });

  describe('Registry Stats', () => {
    it('should return correct stats', async () => {
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'event1.yaml'),
        `type: test.event.v1
description: Test
version: 1
category: ingress`
      );

      await fs.mkdir(path.join(testConfigDir, 'platforms', 'platform1'), { recursive: true });
      await fs.writeFile(
        path.join(testConfigDir, 'platforms', 'platform1', 'mapping.yaml'),
        `platformEvent: EVENT
internalEventType: test.event.v1
fieldMapping:
  userId: user
  channelId: channel`
      );

      await registry.load();

      const stats = registry.getStats();

      expect(stats.eventCount).toBe(1);
      expect(stats.platformCount).toBe(1);
      expect(stats.totalMappings).toBe(1);
      expect(stats.platforms).toContain('platform1');
    });
  });

  describe('Reload', () => {
    it('should reload configuration from disk', async () => {
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'event1.yaml'),
        `type: event.v1
description: Original
version: 1
category: ingress`
      );

      await registry.load();

      let def = registry.findByType('event.v1');
      expect(def?.description).toBe('Original');

      // Modify file
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'event1.yaml'),
        `type: event.v1
description: Updated
version: 1
category: ingress`
      );

      await registry.reload();

      def = registry.findByType('event.v1');
      expect(def?.description).toBe('Updated');
    });

    it('should clear old data before reload', async () => {
      await fs.writeFile(
        path.join(testConfigDir, 'events', 'event1.yaml'),
        `type: event.v1
description: Test
version: 1
category: ingress`
      );

      await registry.load();

      expect(registry.findByType('event.v1')).toBeDefined();

      // Remove file
      await fs.unlink(path.join(testConfigDir, 'events', 'event1.yaml'));

      await registry.reload();

      expect(registry.findByType('event.v1')).toBeUndefined();
    });
  });
});
