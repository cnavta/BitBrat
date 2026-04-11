import { FormatterRegistry, JsonFormatter, DiscordFormatter } from '../formatters';
import { InternalEventV2 } from '../../../../types/events';

describe('Formatters', () => {
  const mockEvent: InternalEventV2 = {
    correlationId: 'test-correlation-id',
    type: 'chat.message.v1',
    payload: {
      text: 'Hello Discord',
      foo: 'bar'
    }
  } as any;

  describe('JsonFormatter', () => {
    test('produces standard structure', () => {
      const formatter = new JsonFormatter();
      const result = formatter.format(mockEvent);
      expect(result).toEqual({
        correlationId: 'test-correlation-id',
        type: 'chat.message.v1',
        payload: {
          text: 'Hello Discord',
          foo: 'bar'
        }
      });
    });
  });

  describe('DiscordFormatter', () => {
    test('maps fields correctly', () => {
      const formatter = new DiscordFormatter();
      const result = formatter.format(mockEvent);
      expect(result).toEqual({
        content: 'Hello Discord',
        username: 'BitBrat (via Gateway)',
        avatar_url: 'https://bitbrat.com/avatar.png'
      });
    });

    test('uses fallback content if text is missing', () => {
      const formatter = new DiscordFormatter();
      const result = formatter.format({ ...mockEvent, payload: {} } as any);
      expect(result.content).toBe('Notification from BitBrat Platform');
    });
  });

  describe('FormatterRegistry', () => {
    test('registers and retrieves formatters', () => {
      const registry = new FormatterRegistry();
      expect(registry.get('json')).toBeInstanceOf(JsonFormatter);
      expect(registry.get('discord')).toBeInstanceOf(DiscordFormatter);
    });

    test('falls back to json for unknown formatter', () => {
      const registry = new FormatterRegistry();
      expect(registry.get('unknown')).toBeInstanceOf(JsonFormatter);
    });
  });
});
