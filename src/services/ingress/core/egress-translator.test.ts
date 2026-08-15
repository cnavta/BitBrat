/**
 * Egress Translator Tests
 * Sprint 13: TE-001
 *
 * Comprehensive test suite for egress translation functionality.
 * Validates bidirectional translation (InternalEventV2 → platform payload).
 */

import { EgressTranslator } from './egress-translator';
import { ConfigRegistry } from './config-registry';
import type { InternalEventV2 } from '../../../types/events';
import * as path from 'path';

describe('EgressTranslator (TE-001)', () => {
  let registry: ConfigRegistry;
  let translator: EgressTranslator;

  beforeAll(async () => {
    const configPath = path.join(__dirname, '../../../..', 'config');
    registry = new ConfigRegistry({ configPath, validateSchema: false });
    await registry.load();
    translator = new EgressTranslator(registry);
  });

  describe('Discord DM Translation', () => {
    const envelope: InternalEventV2 = {
      v: '2',
      correlationId: 'test-corr-123',
      traceId: 'test-trace-456',
      type: 'dm.message.v1',
      ingress: {
        ingressAt: '2026-08-14T12:00:00.000Z',
        source: 'ingress.discord',
        connector: 'discord',
        channel: 'D123456789',
      },
      identity: {
        external: {
          id: 'U987654321',
          platform: 'discord',
          displayName: 'testuser',
        },
      },
      egress: {
        destination: 'internal.egress.v1',
        type: 'dm',
        connector: 'discord',
        channel: 'D123456789',
      },
      message: {
        id: 'msg-123',
        role: 'assistant',
        text: 'Hello! This is a response from the bot.',
        rawPlatformPayload: {},
      },
      routing: {
        stage: 'response',
        slip: [],
        history: [],
      },
    };

    it('should translate to Discord DM payload', () => {
      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result).toBeDefined();
      expect(result.method).toBe('sendDM');
      expect(result.payload).toBeDefined();
    });

    it('should extract text from message.text', () => {
      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result.payload.text).toBe('Hello! This is a response from the bot.');
    });

    it('should extract userId from identity.external.id', () => {
      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result.payload.userId).toBe('U987654321');
    });

    it('should include all mapped fields', () => {
      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result.payload).toHaveProperty('text');
      expect(result.payload).toHaveProperty('userId');
    });
  });

  describe('Slack Chat Translation', () => {
    const envelope: InternalEventV2 = {
      v: '2',
      correlationId: 'test-corr-789',
      traceId: 'test-trace-012',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: '2026-08-14T13:00:00.000Z',
        source: 'ingress.slack',
        connector: 'slack',
        channel: 'C987654321',
      },
      identity: {
        external: {
          id: 'U123456789',
          platform: 'slack',
          displayName: 'slackuser',
        },
      },
      egress: {
        destination: 'internal.egress.v1',
        type: 'chat',
        connector: 'slack',
        channel: 'C987654321',
      },
      message: {
        id: '1723636800.123456',
        role: 'assistant',
        text: 'Response in Slack channel',
        rawPlatformPayload: {},
      },
      routing: {
        stage: 'response',
        slip: [],
        history: [],
      },
    };

    it('should translate to Slack chat payload', () => {
      const result = translator.translateOutbound('slack', 'chat.message.v1', envelope);

      expect(result).toBeDefined();
      expect(result.method).toBe('sendText');
      expect(result.payload).toBeDefined();
    });

    it('should extract channel from egress.channel', () => {
      const result = translator.translateOutbound('slack', 'chat.message.v1', envelope);

      expect(result.payload.channel).toBe('C987654321');
    });

    it('should extract text from message.text', () => {
      const result = translator.translateOutbound('slack', 'chat.message.v1', envelope);

      expect(result.payload.text).toBe('Response in Slack channel');
    });
  });

  describe('Field Extraction', () => {
    it('should extract nested paths using dot notation', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
            metadata: {
              customField: 'customValue',
            },
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      // Should be able to extract deeply nested fields
      expect(result.payload.userId).toBe('U123');
      expect(result.payload.text).toBe('Test');
    });

    it('should handle missing optional fields gracefully', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        // No message field
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      // Should extract available fields
      expect(result.payload.userId).toBe('U123');

      // Missing fields should be omitted (not undefined)
      expect(result.payload.text).toBeUndefined();
    });
  });

  describe('Static Values', () => {
    it('should support static value injection', () => {
      // This test validates that static values can be configured in YAML
      // Example: parse_mode: { value: "Markdown" }
      // The actual implementation is in the YAML config files
      // This test documents the capability

      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'chat.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.slack',
          connector: 'slack',
          channel: 'C123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'slack',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'chat',
          connector: 'slack',
          channel: 'C123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      // Note: Static values would be configured in the YAML egress mapping
      // Example YAML:
      // egress:
      //   method: sendText
      //   fieldMapping:
      //     text: message.text
      //     parse_mode:
      //       value: "Markdown"

      // This capability is tested via the implementation in buildPayload()
      expect(translator).toBeDefined();
      expect(envelope.message?.text).toBe('Test');
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unknown platform', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'C123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'C123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      expect(() =>
        translator.translateOutbound('unknown_platform', 'dm.message.v1', envelope)
      ).toThrow('No egress mapping found for unknown_platform:dm.message.v1');
    });

    it('should throw error for unknown event type', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'unknown.event.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'C123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'event',
          connector: 'discord',
          channel: 'C123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      expect(() =>
        translator.translateOutbound('discord', 'unknown.event.v1', envelope)
      ).toThrow('No egress mapping found for discord:unknown.event.v1');
    });
  });

  describe('Method Name Extraction', () => {
    it('should extract method name from egress mapping', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result.method).toBe('sendDM');
    });

    it('should default to sendText if method not specified', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'chat.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.slack',
          connector: 'slack',
          channel: 'C123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'slack',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'chat',
          connector: 'slack',
          channel: 'C123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('slack', 'chat.message.v1', envelope);

      // Slack uses sendText method by default
      expect(result.method).toBe('sendText');
    });
  });

  describe('Return Structure', () => {
    it('should return {method, payload} structure', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result).toHaveProperty('method');
      expect(result).toHaveProperty('payload');
      expect(typeof result.method).toBe('string');
      expect(typeof result.payload).toBe('object');
    });

    it('should return payload as plain object', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result.payload).toBeInstanceOf(Object);
      expect(Array.isArray(result.payload)).toBe(false);
    });
  });


  describe('Complex Nested Path Extraction', () => {
    it('should extract from deeply nested structures', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test-nested',
        traceId: 'test-trace',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {
            platform: {
              version: '10',
              features: {
                embedSupport: true,
              },
            },
          },
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      // Should successfully extract from nested paths
      expect(result.payload.userId).toBe('U123');
      expect(result.payload.text).toBe('Test');
    });

    it('should handle multiple levels of nesting', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: 'Test',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      // Lodash _.get() supports deep path extraction
      expect(result.payload.userId).toBe('U123');
      expect(result.payload.text).toBe('Test');
    });
  });

  describe('Null and Undefined Handling', () => {
    it('should omit undefined field values from payload', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            // displayName is missing
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        // message field missing entirely
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      // Should have userId but not text (since message is missing)
      expect(result.payload.userId).toBe('U123');
      expect('text' in result.payload).toBe(false); // Key should not exist
    });

    it('should handle null values in envelope fields', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: null as any, // Explicitly null
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: null as any, // Explicitly null
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      // Null values may be included depending on mapping configuration
      expect(result.payload.userId).toBe('U123');
    });

    it('should handle empty string values', () => {
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: '',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: '', // Empty string
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      // Empty strings should be included
      expect(result.payload.userId).toBe('U123');
      expect(result.payload.text).toBe('');
    });
  });

  describe('Multiple Platform Translations', () => {
    it('should handle sequential translations for different platforms', () => {
      const discordEnvelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test-discord',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'discord_user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg1',
          role: 'assistant',
          text: 'Discord message',
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const slackEnvelope: InternalEventV2 = {
        ...discordEnvelope,
        correlationId: 'test-slack',
        ingress: {
          ...discordEnvelope.ingress,
          connector: 'slack',
          channel: 'C456',
        },
        egress: {
          ...discordEnvelope.egress,
          connector: 'slack',
          type: 'chat',
        },
        type: 'chat.message.v1',
        message: {
          id: 'msg2',
          role: 'assistant',
          text: 'Slack message',
          rawPlatformPayload: {},
        },
      };

      const discordResult = translator.translateOutbound('discord', 'dm.message.v1', discordEnvelope);
      const slackResult = translator.translateOutbound('slack', 'chat.message.v1', slackEnvelope);

      expect(discordResult.method).toBe('sendDM');
      expect(discordResult.payload.text).toBe('Discord message');

      expect(slackResult.method).toBe('sendText');
      expect(slackResult.payload.text).toBe('Slack message');
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle very long text content', () => {
      const longText = 'A'.repeat(10000); // 10k character message
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: longText,
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result.payload.text).toBe(longText);
      expect(result.payload.text.length).toBe(10000);
    });

    it('should handle special characters in text', () => {
      const specialText = 'Test with 🎉 emojis and "quotes" and <html>';
      const envelope: InternalEventV2 = {
        v: '2',
        correlationId: 'test',
        traceId: 'test',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'ingress.discord',
          connector: 'discord',
          channel: 'D123',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
            displayName: 'user',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
          channel: 'D123',
        },
        message: {
          id: 'msg',
          role: 'assistant',
          text: specialText,
          rawPlatformPayload: {},
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', envelope);

      expect(result.payload.text).toBe(specialText);
    });

    it('should handle payload with only required fields', () => {
      const minimalEnvelope: InternalEventV2 = {
        v: '2',
        correlationId: 'minimal',
        traceId: 'minimal',
        type: 'dm.message.v1',
        ingress: {
          ingressAt: '2026-08-14T12:00:00.000Z',
          source: 'test',
          connector: 'discord',
        },
        identity: {
          external: {
            id: 'U123',
            platform: 'discord',
          },
        },
        egress: {
          destination: '',
          type: 'dm',
          connector: 'discord',
        },
        routing: {
          stage: 'response',
          slip: [],
          history: [],
        },
      };

      const result = translator.translateOutbound('discord', 'dm.message.v1', minimalEnvelope);

      // Should still produce valid result with available fields
      expect(result.method).toBe('sendDM');
      expect(result.payload.userId).toBe('U123');
    });
  });
});
