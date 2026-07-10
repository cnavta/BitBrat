/**
 * Log Formatter Utilities
 *
 * Utility functions for formatting log entries and traces into various output formats
 * (text, JSON, raw, timeline) for MCP tool responses.
 */

import { LogEntry, LogLevel, TimelineEntry, TraceTimeline } from './types.js';

/**
 * Format logs as human-readable text
 *
 * Output format:
 * 2026-07-10T12:34:56Z [ERROR] [llm-bot] Failed to connect: timeout
 */
export function formatText(logs: LogEntry[]): string {
  if (logs.length === 0) {
    return 'No logs found.';
  }

  const lines = logs.map(log => {
    const timestamp = log.timestamp;
    const level = `[${log.level.toUpperCase().padEnd(5)}]`;
    const service = log.service ? `[${log.service}]` : '';
    const message = log.message || log.msg || '';

    return `${timestamp} ${level} ${service} ${message}`.trim();
  });

  return lines.join('\n');
}

/**
 * Format logs as structured JSON
 */
export function formatJson(logs: LogEntry[]): string {
  return JSON.stringify(logs, null, 2);
}

/**
 * Format logs in raw format (minimal processing)
 */
export function formatRaw(logs: LogEntry[]): string {
  return logs.map(log => JSON.stringify(log)).join('\n');
}

/**
 * Format trace timeline as human-readable text
 *
 * Output format:
 * Correlation ID: evt-123-456-789
 * Duration: 234ms
 * Services: 4 (ingress-egress, event-router, llm-bot, disposition)
 *
 * 00:00:000 [ingress-egress] INFO  Event received from Twitch
 * 00:00:012 [event-router]   INFO  Matched rule: default-llm-routing
 * 00:00:015 [event-router]   DEBUG Attached routing slip with 3 steps
 * ...
 */
export function formatTimeline(trace: TraceTimeline): string {
  if (!trace.timeline || trace.timeline.length === 0) {
    return `Correlation ID: ${trace.correlationId}\nNo logs found for this correlation ID.`;
  }

  // Build header
  const header = [
    `Correlation ID: ${trace.correlationId}`,
    `Duration: ${trace.duration}ms`,
    `Services: ${trace.services.length} (${trace.services.join(', ')})`,
    ''
  ].join('\n');

  // Build timeline entries
  const entries = trace.timeline.map(entry => {
    // Format relative timestamp as HH:MM:SSS
    const relativeTime = formatRelativeTime(entry.relativeMs);
    const service = `[${entry.service}]`.padEnd(20);
    const level = `[${entry.level.toUpperCase()}]`.padEnd(7);
    const message = entry.message;

    return `${relativeTime} ${service} ${level} ${message}`;
  });

  return header + entries.join('\n');
}

/**
 * Format relative timestamp in milliseconds to HH:MM:SSS format
 *
 * Examples:
 * 0 -> 00:00:000
 * 1234 -> 00:00:234
 * 61234 -> 00:01:234
 * 3661234 -> 01:01:234
 */
export function formatRelativeTime(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((ms % (60 * 1000)) / 1000);
  const milliseconds = ms % 1000;

  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  const sss = milliseconds.toString().padStart(3, '0');

  return `${hh}:${mm}:${ss}.${sss}`;
}

/**
 * Format trace as structured JSON
 */
export function formatTraceJson(trace: TraceTimeline): string {
  return JSON.stringify(trace, null, 2);
}

/**
 * Format log summary (count by level)
 */
export function formatLogSummary(logs: LogEntry[]): string {
  const counts: Record<LogLevel, number> = {
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
    trace: 0
  };

  for (const log of logs) {
    counts[log.level] = (counts[log.level] || 0) + 1;
  }

  const summary = [
    `Total logs: ${logs.length}`,
    `  Error: ${counts.error}`,
    `  Warn:  ${counts.warn}`,
    `  Info:  ${counts.info}`,
    `  Debug: ${counts.debug}`,
    `  Trace: ${counts.trace}`
  ];

  return summary.join('\n');
}

/**
 * Truncate long messages for display
 */
export function truncateMessage(message: string, maxLength: number = 100): string {
  if (message.length <= maxLength) {
    return message;
  }
  return message.substring(0, maxLength - 3) + '...';
}

/**
 * Format log entry for compact display
 */
export function formatCompact(log: LogEntry): string {
  const time = new Date(log.timestamp).toLocaleTimeString();
  const level = log.level.toUpperCase().charAt(0); // E/W/I/D/T
  const service = log.service ? log.service.substring(0, 10) : 'unknown';
  const message = truncateMessage(log.message || log.msg || '', 60);

  return `${time} ${level} [${service}] ${message}`;
}

/**
 * Colorize log level (ANSI color codes for terminal output)
 * Note: Only use when output target supports ANSI colors
 */
export function colorizeLevel(level: LogLevel): string {
  const colors: Record<LogLevel, string> = {
    error: '\x1b[31m', // Red
    warn: '\x1b[33m',  // Yellow
    info: '\x1b[36m',  // Cyan
    debug: '\x1b[90m', // Gray
    trace: '\x1b[90m'  // Gray
  };
  const reset = '\x1b[0m';

  return `${colors[level]}${level.toUpperCase()}${reset}`;
}
