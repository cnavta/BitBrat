/**
 * Tests for log formatter utilities
 */

import {
  formatText,
  formatJson,
  formatRaw,
  formatTimeline,
  formatRelativeTime,
  formatTraceJson,
  formatLogSummary,
  truncateMessage,
  formatCompact,
  colorizeLevel
} from '../log-formatter.js';
import { LogEntry, TimelineEntry, TraceTimeline } from '../types.js';

describe('log-formatter', () => {
  const sampleLogs: LogEntry[] = [
    {
      timestamp: '2026-07-10T12:34:56Z',
      level: 'info',
      service: 'llm-bot',
      message: 'Processing request'
    },
    {
      timestamp: '2026-07-10T12:34:57Z',
      level: 'error',
      service: 'llm-bot',
      message: 'Failed to connect',
      correlationId: 'evt-123'
    },
    {
      timestamp: '2026-07-10T12:34:58Z',
      level: 'warn',
      service: 'event-router',
      message: 'High latency detected'
    }
  ];

  describe('formatText', () => {
    it('should format logs as human-readable text', () => {
      const result = formatText(sampleLogs);

      expect(result).toContain('2026-07-10T12:34:56Z');
      expect(result).toContain('[INFO ]'); // Padded to 5 chars
      expect(result).toContain('[llm-bot]');
      expect(result).toContain('Processing request');
      expect(result).toContain('[ERROR]');
      expect(result).toContain('Failed to connect');
    });

    it('should handle empty logs', () => {
      const result = formatText([]);

      expect(result).toBe('No logs found.');
    });

    it('should handle logs without service', () => {
      const logs: LogEntry[] = [
        {
          timestamp: '2026-07-10T12:34:56Z',
          level: 'info',
          message: 'Test message'
        }
      ];

      const result = formatText(logs);

      expect(result).toContain('[INFO ]'); // Padded to 5 chars
      expect(result).toContain('Test message');
    });

    it('should handle logs with msg field instead of message', () => {
      const logs: LogEntry[] = [
        {
          timestamp: '2026-07-10T12:34:56Z',
          level: 'info',
          service: 'test',
          msg: 'Using msg field'
        }
      ];

      const result = formatText(logs);

      expect(result).toContain('Using msg field');
    });
  });

  describe('formatJson', () => {
    it('should format logs as JSON', () => {
      const result = formatJson(sampleLogs);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(3);
      expect(parsed[0].message).toBe('Processing request');
      expect(parsed[1].level).toBe('error');
    });

    it('should handle empty logs', () => {
      const result = formatJson([]);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([]);
    });
  });

  describe('formatRaw', () => {
    it('should format logs as raw JSON lines', () => {
      const result = formatRaw(sampleLogs);
      const lines = result.split('\n');

      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).message).toBe('Processing request');
      expect(JSON.parse(lines[1]).level).toBe('error');
    });

    it('should handle empty logs', () => {
      const result = formatRaw([]);

      expect(result).toBe('');
    });
  });

  describe('formatTimeline', () => {
    const sampleTrace: TraceTimeline = {
      correlationId: 'evt-123-456',
      duration: 234,
      services: ['ingress-egress', 'event-router', 'llm-bot'],
      timeline: [
        {
          relativeMs: 0,
          service: 'ingress-egress',
          level: 'info',
          message: 'Event received from Twitch'
        },
        {
          relativeMs: 12,
          service: 'event-router',
          level: 'info',
          message: 'Matched rule: default-llm-routing'
        },
        {
          relativeMs: 234,
          service: 'llm-bot',
          level: 'debug',
          message: 'OpenAI completion took 164ms'
        }
      ]
    };

    it('should format trace timeline', () => {
      const result = formatTimeline(sampleTrace);

      expect(result).toContain('Correlation ID: evt-123-456');
      expect(result).toContain('Duration: 234ms');
      expect(result).toContain('Services: 3 (ingress-egress, event-router, llm-bot)');
      expect(result).toContain('00:00:00.000');
      expect(result).toContain('00:00:00.012');
      expect(result).toContain('00:00:00.234');
      expect(result).toContain('[ingress-egress]');
      expect(result).toContain('Event received from Twitch');
    });

    it('should handle empty timeline', () => {
      const trace: TraceTimeline = {
        correlationId: 'evt-999',
        duration: 0,
        services: [],
        timeline: []
      };

      const result = formatTimeline(trace);

      expect(result).toContain('Correlation ID: evt-999');
      expect(result).toContain('No logs found');
    });
  });

  describe('formatRelativeTime', () => {
    it('should format 0ms', () => {
      expect(formatRelativeTime(0)).toBe('00:00:00.000');
    });

    it('should format milliseconds', () => {
      expect(formatRelativeTime(234)).toBe('00:00:00.234');
      expect(formatRelativeTime(999)).toBe('00:00:00.999');
    });

    it('should format seconds', () => {
      expect(formatRelativeTime(5000)).toBe('00:00:05.000');
      expect(formatRelativeTime(5234)).toBe('00:00:05.234');
    });

    it('should format minutes', () => {
      expect(formatRelativeTime(61234)).toBe('00:01:01.234');
      expect(formatRelativeTime(125000)).toBe('00:02:05.000');
    });

    it('should format hours', () => {
      expect(formatRelativeTime(3661234)).toBe('01:01:01.234');
      expect(formatRelativeTime(7200000)).toBe('02:00:00.000');
    });
  });

  describe('formatTraceJson', () => {
    it('should format trace as JSON', () => {
      const trace: TraceTimeline = {
        correlationId: 'evt-123',
        duration: 100,
        services: ['test'],
        timeline: []
      };

      const result = formatTraceJson(trace);
      const parsed = JSON.parse(result);

      expect(parsed.correlationId).toBe('evt-123');
      expect(parsed.duration).toBe(100);
      expect(parsed.services).toEqual(['test']);
    });
  });

  describe('formatLogSummary', () => {
    it('should format log summary with counts', () => {
      const result = formatLogSummary(sampleLogs);

      expect(result).toContain('Total logs: 3');
      expect(result).toContain('Error: 1');
      expect(result).toContain('Warn:  1');
      expect(result).toContain('Info:  1');
    });

    it('should handle empty logs', () => {
      const result = formatLogSummary([]);

      expect(result).toContain('Total logs: 0');
      expect(result).toContain('Error: 0');
    });

    it('should count all log levels', () => {
      const logs: LogEntry[] = [
        { timestamp: '2026-07-10T12:00:00Z', level: 'error', service: 'test', message: 'E1' },
        { timestamp: '2026-07-10T12:00:01Z', level: 'error', service: 'test', message: 'E2' },
        { timestamp: '2026-07-10T12:00:02Z', level: 'warn', service: 'test', message: 'W1' },
        { timestamp: '2026-07-10T12:00:03Z', level: 'info', service: 'test', message: 'I1' },
        { timestamp: '2026-07-10T12:00:04Z', level: 'debug', service: 'test', message: 'D1' },
        { timestamp: '2026-07-10T12:00:05Z', level: 'trace', service: 'test', message: 'T1' }
      ];

      const result = formatLogSummary(logs);

      expect(result).toContain('Total logs: 6');
      expect(result).toContain('Error: 2');
      expect(result).toContain('Warn:  1');
      expect(result).toContain('Info:  1');
      expect(result).toContain('Debug: 1');
      expect(result).toContain('Trace: 1');
    });
  });

  describe('truncateMessage', () => {
    it('should not truncate short messages', () => {
      const message = 'Short message';
      expect(truncateMessage(message)).toBe(message);
    });

    it('should truncate long messages', () => {
      const message = 'a'.repeat(150);
      const result = truncateMessage(message, 100);

      expect(result.length).toBe(100);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should use default max length of 100', () => {
      const message = 'a'.repeat(150);
      const result = truncateMessage(message);

      expect(result.length).toBe(100);
    });
  });

  describe('formatCompact', () => {
    it('should format log compactly', () => {
      const log: LogEntry = {
        timestamp: '2026-07-10T12:34:56Z',
        level: 'info',
        service: 'llm-bot',
        message: 'Test message'
      };

      const result = formatCompact(log);

      expect(result).toContain('I'); // Info -> I
      expect(result).toContain('[llm-bot]');
      expect(result).toContain('Test message');
    });

    it('should truncate long messages', () => {
      const log: LogEntry = {
        timestamp: '2026-07-10T12:34:56Z',
        level: 'error',
        service: 'test',
        message: 'a'.repeat(100)
      };

      const result = formatCompact(log);

      expect(result).toContain('...');
    });

    it('should handle missing service', () => {
      const log: LogEntry = {
        timestamp: '2026-07-10T12:34:56Z',
        level: 'warn',
        message: 'Warning'
      };

      const result = formatCompact(log);

      expect(result).toContain('[unknown]');
    });
  });

  describe('colorizeLevel', () => {
    it('should colorize error level', () => {
      const result = colorizeLevel('error');

      expect(result).toContain('ERROR');
      expect(result).toContain('\x1b[31m'); // Red
    });

    it('should colorize warn level', () => {
      const result = colorizeLevel('warn');

      expect(result).toContain('WARN');
      expect(result).toContain('\x1b[33m'); // Yellow
    });

    it('should colorize info level', () => {
      const result = colorizeLevel('info');

      expect(result).toContain('INFO');
      expect(result).toContain('\x1b[36m'); // Cyan
    });

    it('should include reset code', () => {
      const result = colorizeLevel('error');

      expect(result).toContain('\x1b[0m'); // Reset
    });
  });
});
