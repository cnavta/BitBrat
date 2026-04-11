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

    test('selects best candidate text', () => {
      const formatter = new JsonFormatter();
      const eventWithCandidates: InternalEventV2 = {
        ...mockEvent,
        candidates: [
          { id: '1', text: 'Candidate 1', priority: 10, createdAt: '2021-01-01T00:00:00Z', status: 'proposed', kind: 'text', source: 'test' },
          { id: '2', text: 'Best Candidate', priority: 1, createdAt: '2021-01-01T00:00:00Z', status: 'proposed', kind: 'text', source: 'test' }
        ]
      } as any;
      const result = formatter.format(eventWithCandidates);
      expect(result.payload.text).toBe('Best Candidate');
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

    test('selects best candidate text', () => {
      const formatter = new DiscordFormatter();
      const eventWithCandidates: InternalEventV2 = {
        ...mockEvent,
        candidates: [
          { id: '1', text: 'Candidate 1', priority: 10, createdAt: '2021-01-01T00:00:00Z', status: 'proposed', kind: 'text', source: 'test' },
          { id: '2', text: 'Best Candidate', priority: 1, createdAt: '2021-01-01T00:00:00Z', status: 'proposed', kind: 'text', source: 'test' }
        ]
      } as any;
      const result = formatter.format(eventWithCandidates);
      expect(result.content).toBe('Best Candidate');
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
