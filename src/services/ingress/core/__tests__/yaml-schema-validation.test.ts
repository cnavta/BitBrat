/**
 * YAML Schema Validation Tests
 *
 * Validates that event definition and platform mapping YAML files
 * conform to their respective JSON schemas.
 *
 * Sprint 13: DX Foundation (DX-005)
 *
 * @since Sprint 13
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

describe('YAML Schema Validation', () => {
  let ajv: Ajv;
  let eventDefinitionSchema: any;
  let platformMappingSchema: any;

  beforeAll(async () => {
    ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);

    // Load schemas
    const schemasPath = path.join(process.cwd(), 'config', 'schemas');

    const eventDefSchemaPath = path.join(schemasPath, 'event-definition.schema.json');
    const platformMapSchemaPath = path.join(schemasPath, 'platform-mapping.schema.json');

    eventDefinitionSchema = JSON.parse(await fs.readFile(eventDefSchemaPath, 'utf-8'));
    platformMappingSchema = JSON.parse(await fs.readFile(platformMapSchemaPath, 'utf-8'));
  });

  describe('Event Definitions', () => {
    it('should validate chat-message.v1.yaml', async () => {
      const filePath = path.join(process.cwd(), 'config', 'events', 'chat-message.v1.yaml');
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(eventDefinitionSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        type: 'chat.message.v1',
        version: 1,
        category: 'bidirectional',
      });
    });

    it('should validate dm-message.v1.yaml', async () => {
      const filePath = path.join(process.cwd(), 'config', 'events', 'dm-message.v1.yaml');
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(eventDefinitionSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        type: 'dm.message.v1',
        version: 1,
        category: 'bidirectional',
      });
    });
  });

  describe('Discord Platform Mappings', () => {
    it('should validate discord/chat-message.v1.yaml', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(platformMappingSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'chat.message.v1',
        priority: 0,
      });
      expect(data.fieldMapping).toHaveProperty('userId');
      expect(data.fieldMapping).toHaveProperty('channelId');
    });

    it('should validate discord/dm-message.v1.yaml', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'dm-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(platformMappingSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        platformEvent: 'MESSAGE_CREATE',
        internalEventType: 'dm.message.v1',
        priority: 10,
      });
      expect(data.fieldMapping).toHaveProperty('userId');
      expect(data.filter).toBeDefined(); // DM should have filter
    });
  });

  describe('Field Mapping Validation', () => {
    it('should have required fields in Discord chat mapping', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data: any = yaml.load(content);

      // Required fields per backlog technical notes
      expect(data.fieldMapping.userId).toBeDefined();
      expect(data.fieldMapping.channelId).toBeDefined();
      expect(data.fieldMapping.messageText).toBeDefined();
      expect(data.fieldMapping.messageId).toBeDefined();
    });

    it('should have userName with fallbacks', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data: any = yaml.load(content);

      expect(data.fieldMapping.userName).toBeDefined();

      // Check if it's a complex mapping with fallbacks
      if (typeof data.fieldMapping.userName === 'object') {
        expect(data.fieldMapping.userName.path).toBe('author.username');
        expect(data.fieldMapping.userName.fallbacks).toBeDefined();
      }
    });
  });

  describe('Priority and Filter Validation', () => {
    it('should have DM mapping with higher priority than chat', async () => {
      const dmPath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'dm-message.v1.yaml'
      );
      const chatPath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'chat-message.v1.yaml'
      );

      const dmData: any = yaml.load(await fs.readFile(dmPath, 'utf-8'));
      const chatData: any = yaml.load(await fs.readFile(chatPath, 'utf-8'));

      expect(dmData.priority).toBeGreaterThan(chatData.priority);
    });

    it('should have JSONLogic filter for DM detection', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'dm-message.v1.yaml'
      );
      const data: any = yaml.load(await fs.readFile(filePath, 'utf-8'));

      expect(data.filter).toBeDefined();
      expect(data.filter).toHaveProperty('==');

      // Verify filter checks channelType === 1 (normalized field from DiscordMessageMeta)
      const filterArray = data.filter['=='];
      expect(filterArray).toHaveLength(2);
      expect(filterArray[0]).toEqual({ var: 'channelType' });
      expect(filterArray[1]).toBe(1);
    });
  });

  describe('Slack Platform Mappings', () => {
    it('should validate slack/chat-message.v1.yaml', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'slack',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(platformMappingSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        platformEvent: 'message',
        internalEventType: 'chat.message.v1',
        priority: 0,
      });
      expect(data.fieldMapping).toHaveProperty('userId');
      expect(data.fieldMapping).toHaveProperty('channelId');
    });

    it('should have required fields in Slack chat mapping', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'slack',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data: any = yaml.load(content);

      // Required fields per backlog technical notes
      expect(data.fieldMapping.userId).toBeDefined();
      expect(data.fieldMapping.channelId).toBeDefined();
      expect(data.fieldMapping.messageText).toBeDefined();
      expect(data.fieldMapping.messageId).toBeDefined();
    });

    it('should have JSONLogic filter for bot message filtering', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'slack',
        'chat-message.v1.yaml'
      );
      const data: any = yaml.load(await fs.readFile(filePath, 'utf-8'));

      expect(data.filter).toBeDefined();
      expect(data.filter).toHaveProperty('and');

      // Verify filter checks event type and excludes bots
      const andConditions = data.filter.and;
      expect(andConditions).toHaveLength(2);

      // First condition: event type === 'message'
      expect(andConditions[0]).toEqual({
        '==': [{ var: 'type' }, 'message'],
      });

      // Second condition: NOT bot_id (exclude bots)
      expect(andConditions[1]).toEqual({
        '!': { var: 'bot_id' },
      });
    });

    it('should validate slack/dm-message.v1.yaml', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'slack',
        'dm-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(platformMappingSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        platformEvent: 'message',
        internalEventType: 'dm.message.v1',
        priority: 10,
      });
      expect(data.fieldMapping).toHaveProperty('userId');
      expect(data.fieldMapping).toHaveProperty('channelId');
    });

    it('should have DM mapping with higher priority than chat', async () => {
      const dmPath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'slack',
        'dm-message.v1.yaml'
      );
      const chatPath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'slack',
        'chat-message.v1.yaml'
      );

      const dmData: any = yaml.load(await fs.readFile(dmPath, 'utf-8'));
      const chatData: any = yaml.load(await fs.readFile(chatPath, 'utf-8'));

      expect(dmData.priority).toBeGreaterThan(chatData.priority);
    });

    it('should have JSONLogic filter for Slack DM detection', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'slack',
        'dm-message.v1.yaml'
      );
      const data: any = yaml.load(await fs.readFile(filePath, 'utf-8'));

      expect(data.filter).toBeDefined();
      expect(data.filter).toHaveProperty('and');

      // Verify filter checks event type, excludes bots, and detects DM channel
      const andConditions = data.filter.and;
      expect(andConditions).toHaveLength(3);

      // First condition: event type === 'message'
      expect(andConditions[0]).toEqual({
        '==': [{ var: 'type' }, 'message'],
      });

      // Second condition: NOT bot_id (exclude bots)
      expect(andConditions[1]).toEqual({
        '!': { var: 'bot_id' },
      });

      // Third condition: channel ID starts with 'D' (DM detection)
      expect(andConditions[2]).toEqual({
        '==': [
          {
            substr: [{ var: 'channel' }, 0, 1],
          },
          'D',
        ],
      });
    });
  });

  describe('Twitch Platform Mappings', () => {
    it('should validate twitch/chat-message.v1.yaml', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'twitch',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(platformMappingSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        platformEvent: 'PRIVMSG',
        internalEventType: 'chat.message.v1',
        priority: 0,
      });
      expect(data.fieldMapping).toHaveProperty('userId');
      expect(data.fieldMapping).toHaveProperty('channelId');
    });

    it('should have required fields in Twitch chat mapping', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'twitch',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data: any = yaml.load(content);

      // Required fields per backlog technical notes
      expect(data.fieldMapping.userId).toBeDefined();
      expect(data.fieldMapping.channelId).toBeDefined();
      expect(data.fieldMapping.messageText).toBeDefined();
    });

    it('should have userId with fallback to userLogin', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'twitch',
        'chat-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data: any = yaml.load(content);

      expect(data.fieldMapping.userId).toBeDefined();

      // Check if it's a complex mapping with fallbacks
      if (typeof data.fieldMapping.userId === 'object') {
        expect(data.fieldMapping.userId.path).toBe('userId');
        expect(data.fieldMapping.userId.fallbacks).toBeDefined();
        expect(data.fieldMapping.userId.fallbacks).toContain('userLogin');
      }
    });

    it('should validate twitch/dm-message.v1.yaml', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'twitch',
        'dm-message.v1.yaml'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data = yaml.load(content);

      const validate = ajv.compile(platformMappingSchema);
      const valid = validate(data);

      if (!valid) {
        console.error('Validation errors:', JSON.stringify(validate.errors, null, 2));
      }

      expect(valid).toBe(true);
      expect(data).toMatchObject({
        platformEvent: 'whisper',
        internalEventType: 'dm.message.v1',
        priority: 10,
      });
      expect(data.fieldMapping).toHaveProperty('userId');
      expect(data.fieldMapping).toHaveProperty('messageText');
    });

    it('should have Twitch DM mapping with higher priority than chat', async () => {
      const dmPath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'twitch',
        'dm-message.v1.yaml'
      );
      const chatPath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'twitch',
        'chat-message.v1.yaml'
      );

      const dmData: any = yaml.load(await fs.readFile(dmPath, 'utf-8'));
      const chatData: any = yaml.load(await fs.readFile(chatPath, 'utf-8'));

      expect(dmData.priority).toBeGreaterThan(chatData.priority);
    });
  });

  describe('Regression - Existing Behavior', () => {
    it('should map MESSAGE_CREATE to chat.message.v1 by default', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'chat-message.v1.yaml'
      );
      const data: any = yaml.load(await fs.readFile(filePath, 'utf-8'));

      expect(data.platformEvent).toBe('MESSAGE_CREATE');
      expect(data.internalEventType).toBe('chat.message.v1');
    });

    it('should extract userId from authorId (DiscordMessageMeta)', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'chat-message.v1.yaml'
      );
      const data: any = yaml.load(await fs.readFile(filePath, 'utf-8'));

      // Discord normalizes to DiscordMessageMeta before passing to builder
      // So YAML maps from normalized structure, not raw Discord.js Message
      if (typeof data.fieldMapping.userId === 'object') {
        expect(data.fieldMapping.userId.path).toBe('authorId');
      } else {
        expect(data.fieldMapping.userId).toBe('authorId');
      }
    });

    it('should extract channelId from channelId (DiscordMessageMeta)', async () => {
      const filePath = path.join(
        process.cwd(),
        'config',
        'platforms',
        'discord',
        'chat-message.v1.yaml'
      );
      const data: any = yaml.load(await fs.readFile(filePath, 'utf-8'));

      // Discord normalizes to DiscordMessageMeta before passing to builder
      // So YAML maps from normalized structure, not raw Discord.js Message
      if (typeof data.fieldMapping.channelId === 'object') {
        expect(data.fieldMapping.channelId.path).toBe('channelId');
      } else {
        expect(data.fieldMapping.channelId).toBe('channelId');
      }
    });
  });
});
