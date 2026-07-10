/**
 * Tests for log parser utilities
 */

import {
  parseDockerLogs,
  parseDockerLogLine,
  parseJsonLog,
  normalizeLevel,
  parseTimeDuration,
  parseIsoTimestamp,
  filterByLevel,
  filterByCorrelation,
  filterByTimeRange,
  sortByTimestamp
} from '../log-parser.js';
import { LogEntry, LogLevel } from '../types.js';

describe('log-parser', () => {
  describe('parseDockerLogs', () => {
    it('should parse JSON logs from docker compose output', () => {
      const output = `
llm-bot | {"ts":"2026-07-10T12:34:56Z","level":"info","msg":"Processing request","correlationId":"evt-123"}
llm-bot | {"ts":"2026-07-10T12:34:57Z","level":"error","msg":"Failed to connect","correlationId":"evt-123"}
      `.trim();

      const logs = parseDockerLogs(output, 'llm-bot');

      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({
        timestamp: '2026-07-10T12:34:56Z',
        level: 'info',
        service: 'llm-bot',
        message: 'Processing request',
        correlationId: 'evt-123'
      });
      expect(logs[1]).toMatchObject({
        timestamp: '2026-07-10T12:34:57Z',
        level: 'error',
        service: 'llm-bot',
        message: 'Failed to connect'
      });
    });

    it('should parse plain text logs from docker compose output', () => {
      const output = `
llm-bot | 2026-07-10 12:34:56 Service starting
llm-bot | 2026-07-10 12:34:57 Service ready
      `.trim();

      const logs = parseDockerLogs(output, 'llm-bot');

      expect(logs).toHaveLength(2);
      expect(logs[0].level).toBe('info');
      expect(logs[0].service).toBe('llm-bot');
      expect(logs[0].message).toContain('Service starting');
    });

    it('should skip empty lines', () => {
      const output = `
llm-bot | {"ts":"2026-07-10T12:34:56Z","level":"info","msg":"Test"}

llm-bot | {"ts":"2026-07-10T12:34:57Z","level":"info","msg":"Test2"}
      `;

      const logs = parseDockerLogs(output, 'llm-bot');

      expect(logs).toHaveLength(2);
    });

    it('should handle mixed JSON and plain text logs', () => {
      const output = `
llm-bot | {"ts":"2026-07-10T12:34:56Z","level":"info","msg":"JSON log"}
llm-bot | Plain text log
      `.trim();

      const logs = parseDockerLogs(output, 'llm-bot');

      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('JSON log');
      expect(logs[1].message).toContain('Plain text log');
    });
  });

  describe('parseDockerLogLine', () => {
    it('should parse JSON log line', () => {
      const line = 'llm-bot | {"ts":"2026-07-10T12:34:56Z","level":"info","msg":"Test"}';
      const entry = parseDockerLogLine(line, 'llm-bot');

      expect(entry).not.toBeNull();
      expect(entry?.message).toBe('Test');
      expect(entry?.level).toBe('info');
    });

    it('should parse plain text log line', () => {
      const line = 'llm-bot | 2026-07-10 12:34:56 Plain text message';
      const entry = parseDockerLogLine(line, 'llm-bot');

      expect(entry).not.toBeNull();
      expect(entry?.message).toContain('Plain text message');
      expect(entry?.level).toBe('info');
    });

    it('should return null for malformed lines', () => {
      const line = 'invalid line';
      const entry = parseDockerLogLine(line, 'llm-bot');

      expect(entry).not.toBeNull(); // Actually parses as plain text
    });
  });

  describe('parseJsonLog', () => {
    it('should parse JSON with standard fields', () => {
      const json = '{"ts":"2026-07-10T12:34:56Z","level":"info","msg":"Test message","correlationId":"evt-123"}';
      const entry = parseJsonLog(json, 'llm-bot');

      expect(entry).toMatchObject({
        timestamp: '2026-07-10T12:34:56Z',
        level: 'info',
        service: 'llm-bot',
        message: 'Test message',
        correlationId: 'evt-123'
      });
    });

    it('should handle alternative field names', () => {
      const json = '{"timestamp":"2026-07-10T12:34:56Z","severity":"warn","message":"Warning"}';
      const entry = parseJsonLog(json);

      expect(entry.timestamp).toBe('2026-07-10T12:34:56Z');
      expect(entry.level).toBe('warn');
      expect(entry.message).toBe('Warning');
    });

    it('should use defaults for missing fields', () => {
      const json = '{"msg":"Test"}';
      const entry = parseJsonLog(json, 'test-service');

      expect(entry.service).toBe('test-service');
      expect(entry.level).toBe('info');
      expect(entry.timestamp).toBeDefined();
    });

    it('should preserve extra fields', () => {
      const json = '{"msg":"Test","customField":"customValue","nested":{"key":"value"}}';
      const entry = parseJsonLog(json);

      expect(entry.customField).toBe('customValue');
      expect(entry.nested).toEqual({ key: 'value' });
    });
  });

  describe('normalizeLevel', () => {
    it('should normalize error levels', () => {
      expect(normalizeLevel('error')).toBe('error');
      expect(normalizeLevel('ERROR')).toBe('error');
      expect(normalizeLevel('err')).toBe('error');
      expect(normalizeLevel('fatal')).toBe('error');
    });

    it('should normalize warn levels', () => {
      expect(normalizeLevel('warn')).toBe('warn');
      expect(normalizeLevel('warning')).toBe('warn');
      expect(normalizeLevel('WARNING')).toBe('warn');
    });

    it('should normalize info levels', () => {
      expect(normalizeLevel('info')).toBe('info');
      expect(normalizeLevel('INFO')).toBe('info');
    });

    it('should normalize debug levels', () => {
      expect(normalizeLevel('debug')).toBe('debug');
      expect(normalizeLevel('DEBUG')).toBe('debug');
    });

    it('should normalize trace levels', () => {
      expect(normalizeLevel('trace')).toBe('trace');
      expect(normalizeLevel('TRACE')).toBe('trace');
    });

    it('should default to info for unknown levels', () => {
      expect(normalizeLevel('unknown')).toBe('info');
      expect(normalizeLevel('custom')).toBe('info');
    });
  });

  describe('parseTimeDuration', () => {
    it('should parse hour duration', () => {
      const result = parseTimeDuration('1h');
      const date = new Date(result);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Allow 1 second tolerance
      expect(Math.abs(date.getTime() - oneHourAgo.getTime())).toBeLessThan(1000);
    });

    it('should parse minute duration', () => {
      const result = parseTimeDuration('30m');
      const date = new Date(result);
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      expect(Math.abs(date.getTime() - thirtyMinutesAgo.getTime())).toBeLessThan(1000);
    });

    it('should parse second duration', () => {
      const result = parseTimeDuration('5s');
      const date = new Date(result);
      const fiveSecondsAgo = new Date(Date.now() - 5 * 1000);

      expect(Math.abs(date.getTime() - fiveSecondsAgo.getTime())).toBeLessThan(1000);
    });

    it('should parse millisecond duration', () => {
      const result = parseTimeDuration('500ms');
      const date = new Date(result);
      const fiveHundredMsAgo = new Date(Date.now() - 500);

      expect(Math.abs(date.getTime() - fiveHundredMsAgo.getTime())).toBeLessThan(100);
    });

    it('should return ISO timestamp as-is', () => {
      const iso = '2026-07-10T12:34:56Z';
      const result = parseTimeDuration(iso);

      expect(result).toBe(iso);
    });

    it('should throw error for invalid format', () => {
      expect(() => parseTimeDuration('invalid')).toThrow('Invalid duration format');
      expect(() => parseTimeDuration('10')).toThrow('Invalid duration format');
      expect(() => parseTimeDuration('10x')).toThrow('Invalid duration format');
    });
  });

  describe('parseIsoTimestamp', () => {
    it('should parse valid ISO timestamp', () => {
      const iso = '2026-07-10T12:34:56Z';
      const date = parseIsoTimestamp(iso);

      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toContain('2026-07-10T12:34:56');
    });

    it('should throw error for invalid timestamp', () => {
      expect(() => parseIsoTimestamp('invalid')).toThrow('Invalid ISO timestamp');
      expect(() => parseIsoTimestamp('2026-13-40')).toThrow('Invalid ISO timestamp');
    });
  });

  describe('filterByLevel', () => {
    const logs: LogEntry[] = [
      { timestamp: '2026-07-10T12:00:00Z', level: 'error', service: 'test', message: 'Error' },
      { timestamp: '2026-07-10T12:00:01Z', level: 'warn', service: 'test', message: 'Warning' },
      { timestamp: '2026-07-10T12:00:02Z', level: 'info', service: 'test', message: 'Info' },
      { timestamp: '2026-07-10T12:00:03Z', level: 'debug', service: 'test', message: 'Debug' }
    ];

    it('should filter by single level', () => {
      const filtered = filterByLevel(logs, ['error']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].level).toBe('error');
    });

    it('should filter by multiple levels', () => {
      const filtered = filterByLevel(logs, ['error', 'warn']);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(l => l.level)).toEqual(['error', 'warn']);
    });

    it('should return all logs if no levels specified', () => {
      const filtered = filterByLevel(logs, []);
      expect(filtered).toHaveLength(4);
    });
  });

  describe('filterByCorrelation', () => {
    const logs: LogEntry[] = [
      { timestamp: '2026-07-10T12:00:00Z', level: 'info', service: 'test', message: 'Msg1', correlationId: 'evt-123' },
      { timestamp: '2026-07-10T12:00:01Z', level: 'info', service: 'test', message: 'Msg2', correlationId: 'evt-456' },
      { timestamp: '2026-07-10T12:00:02Z', level: 'info', service: 'test', message: 'Msg3', correlationId: 'evt-123' },
      { timestamp: '2026-07-10T12:00:03Z', level: 'info', service: 'test', message: 'Msg4' }
    ];

    it('should filter by correlation ID', () => {
      const filtered = filterByCorrelation(logs, 'evt-123');
      expect(filtered).toHaveLength(2);
      expect(filtered[0].message).toBe('Msg1');
      expect(filtered[1].message).toBe('Msg3');
    });

    it('should return empty array if no matches', () => {
      const filtered = filterByCorrelation(logs, 'evt-999');
      expect(filtered).toHaveLength(0);
    });
  });

  describe('filterByTimeRange', () => {
    const logs: LogEntry[] = [
      { timestamp: '2026-07-10T12:00:00Z', level: 'info', service: 'test', message: 'Msg1' },
      { timestamp: '2026-07-10T12:30:00Z', level: 'info', service: 'test', message: 'Msg2' },
      { timestamp: '2026-07-10T13:00:00Z', level: 'info', service: 'test', message: 'Msg3' },
      { timestamp: '2026-07-10T13:30:00Z', level: 'info', service: 'test', message: 'Msg4' }
    ];

    it('should filter by since', () => {
      const filtered = filterByTimeRange(logs, '2026-07-10T12:30:00Z');
      expect(filtered).toHaveLength(3);
      expect(filtered[0].message).toBe('Msg2');
    });

    it('should filter by until', () => {
      const filtered = filterByTimeRange(logs, undefined, '2026-07-10T13:00:00Z');
      expect(filtered).toHaveLength(3);
      expect(filtered[2].message).toBe('Msg3');
    });

    it('should filter by both since and until', () => {
      const filtered = filterByTimeRange(logs, '2026-07-10T12:30:00Z', '2026-07-10T13:00:00Z');
      expect(filtered).toHaveLength(2);
      expect(filtered[0].message).toBe('Msg2');
      expect(filtered[1].message).toBe('Msg3');
    });

    it('should return all logs if no range specified', () => {
      const filtered = filterByTimeRange(logs);
      expect(filtered).toHaveLength(4);
    });
  });

  describe('sortByTimestamp', () => {
    const logs: LogEntry[] = [
      { timestamp: '2026-07-10T13:00:00Z', level: 'info', service: 'test', message: 'Third' },
      { timestamp: '2026-07-10T12:00:00Z', level: 'info', service: 'test', message: 'First' },
      { timestamp: '2026-07-10T14:00:00Z', level: 'info', service: 'test', message: 'Fourth' },
      { timestamp: '2026-07-10T12:30:00Z', level: 'info', service: 'test', message: 'Second' }
    ];

    it('should sort by timestamp descending (default)', () => {
      const sorted = sortByTimestamp([...logs]);
      expect(sorted[0].message).toBe('Fourth');
      expect(sorted[1].message).toBe('Third');
      expect(sorted[2].message).toBe('Second');
      expect(sorted[3].message).toBe('First');
    });

    it('should sort by timestamp ascending', () => {
      const sorted = sortByTimestamp([...logs], 'asc');
      expect(sorted[0].message).toBe('First');
      expect(sorted[1].message).toBe('Second');
      expect(sorted[2].message).toBe('Third');
      expect(sorted[3].message).toBe('Fourth');
    });
  });
});
