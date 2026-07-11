/**
 * Log Parser Utilities
 *
 * Utility functions for parsing logs from various sources (Docker, Cloud Run)
 * and transforming them into standardized LogEntry objects.
 */

import { LogEntry, LogLevel } from './types.js';

/**
 * Parse docker compose logs output into LogEntry objects
 *
 * Docker compose format: "service-name | {...}" for JSON logs
 * or "service-name | plain text" for text logs
 */
export function parseDockerLogs(output: string, serviceName: string): LogEntry[] {
  const lines = output.split('\n').filter(line => line.trim());
  const entries: LogEntry[] = [];

  for (const line of lines) {
    const entry = parseDockerLogLine(line, serviceName);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Parse a single docker compose log line
 */
export function parseDockerLogLine(line: string, serviceName: string): LogEntry | null {
  try {
    // Try to extract JSON from the line
    // Format 1: docker compose logs format: "service-name | {...}"
    const composeMatch = line.match(/\|\s*(\{.*\})/);

    if (composeMatch) {
      // Parse JSON log with pipe delimiter (docker compose logs)
      return parseJsonLog(composeMatch[1], serviceName);
    }

    // Format 2: docker logs format (raw JSON, no pipe delimiter)
    // Check if line itself is valid JSON
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return parseJsonLog(trimmed, serviceName);
      } catch (jsonError) {
        // Not valid JSON, fall through to plain text handling
      }
    }

    // Plain text log - extract timestamp if present
    const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
    return {
      timestamp: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
      level: 'info',
      service: serviceName,
      message: line.replace(/^[^\|]+\|\s*/, '') // Remove service prefix
    };
  } catch (e) {
    // Skip malformed lines
    return null;
  }
}

/**
 * Parse a JSON log entry
 */
export function parseJsonLog(jsonString: string, serviceName?: string): LogEntry {
  const json = JSON.parse(jsonString);
  return {
    timestamp: json.ts || json.timestamp || new Date().toISOString(),
    level: normalizeLevel(json.level || json.severity || 'info'),
    service: serviceName || json.service || 'unknown',
    message: json.msg || json.message || '',
    correlationId: json.correlationId,
    ...json
  };
}

/**
 * Normalize log level to standard BitBrat levels
 */
export function normalizeLevel(level: string): LogLevel {
  const lower = level.toLowerCase();
  if (lower === 'error' || lower === 'err' || lower === 'fatal') return 'error';
  if (lower === 'warn' || lower === 'warning') return 'warn';
  if (lower === 'info') return 'info';
  if (lower === 'debug') return 'debug';
  if (lower === 'trace') return 'trace';
  return 'info'; // Default
}

/**
 * Parse time duration string (e.g., "1h", "30m", "5s") to ISO timestamp
 *
 * Supports:
 * - h (hours)
 * - m (minutes)
 * - s (seconds)
 * - ms (milliseconds)
 *
 * If input is already an ISO timestamp, returns as-is.
 */
export function parseTimeDuration(duration: string): string {
  // If already ISO format, return as-is
  if (duration.includes('T') || duration.includes('Z')) {
    return duration;
  }

  // Parse duration string
  const match = duration.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use ISO timestamp or duration like "1h", "30m", "5s"`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  // Calculate milliseconds
  let ms = 0;
  switch (unit) {
    case 'ms':
      ms = value;
      break;
    case 's':
      ms = value * 1000;
      break;
    case 'm':
      ms = value * 60 * 1000;
      break;
    case 'h':
      ms = value * 60 * 60 * 1000;
      break;
  }

  // Calculate timestamp (duration ago from now)
  const now = Date.now();
  const timestamp = new Date(now - ms);

  return timestamp.toISOString();
}

/**
 * Validate and parse ISO timestamp
 */
export function parseIsoTimestamp(timestamp: string): Date {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${timestamp}`);
  }
  return date;
}

/**
 * Filter log entries by level
 */
export function filterByLevel(logs: LogEntry[], levels: LogLevel[]): LogEntry[] {
  if (!levels || levels.length === 0) {
    return logs;
  }
  return logs.filter(log => levels.includes(log.level));
}

/**
 * Filter log entries by correlation ID
 */
export function filterByCorrelation(logs: LogEntry[], correlationId: string): LogEntry[] {
  return logs.filter(log => log.correlationId === correlationId);
}

/**
 * Filter log entries by time range
 */
export function filterByTimeRange(
  logs: LogEntry[],
  since?: string,
  until?: string
): LogEntry[] {
  let filtered = logs;

  if (since) {
    const sinceDate = new Date(since);
    filtered = filtered.filter(log => new Date(log.timestamp) >= sinceDate);
  }

  if (until) {
    const untilDate = new Date(until);
    filtered = filtered.filter(log => new Date(log.timestamp) <= untilDate);
  }

  return filtered;
}

/**
 * Sort log entries by timestamp
 */
export function sortByTimestamp(logs: LogEntry[], order: 'asc' | 'desc' = 'desc'): LogEntry[] {
  return logs.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return order === 'asc' ? aTime - bTime : bTime - aTime;
  });
}
