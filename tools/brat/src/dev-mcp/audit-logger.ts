/**
 * Audit Logger
 *
 * Logs all tool invocations to a file for audit purposes.
 * Redacts sensitive information from arguments.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AuditLogEntry } from './types.js';
import { Logger } from '../orchestration/logger';

const DEFAULT_AUDIT_LOG_PATH = '.brat/dev-mcp-audit.log';

/**
 * Sensitive keys to redact from tool arguments
 */
const SENSITIVE_KEYS = [
  'token',
  'password',
  'secret',
  'key',
  'authorization',
  'auth',
  'credential',
];

/**
 * Audit logger for tool invocations
 */
export class AuditLogger {
  private logPath: string;
  private logger: Logger;
  private logStream?: fs.FileHandle;

  constructor(logPath: string | undefined, logger: Logger) {
    this.logPath = logPath || DEFAULT_AUDIT_LOG_PATH;
    this.logger = logger;
  }

  /**
   * Initialize audit log file
   */
  private async initialize(): Promise<void> {
    if (this.logStream) {
      return;
    }

    // Ensure directory exists
    const dir = path.dirname(this.logPath);
    await fs.mkdir(dir, { recursive: true });

    // Open file for appending
    this.logStream = await fs.open(this.logPath, 'a');
    this.logger.debug({ path: this.logPath }, 'Audit log initialized');
  }

  /**
   * Log a tool invocation
   */
  async logToolCall(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    await this.initialize();

    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      args: this.redactSensitiveArgs(entry.args),
    };

    // Write as JSON line
    const line = JSON.stringify(fullEntry) + '\n';
    await this.logStream!.write(line);

    this.logger.debug({
      tool: entry.tool,
      success: entry.success,
    }, 'Audit log entry written');
  }

  /**
   * Redact sensitive information from arguments
   */
  private redactSensitiveArgs(args: Record<string, any>): Record<string, any> {
    const redacted: Record<string, any> = {};

    for (const [key, value] of Object.entries(args)) {
      // Check if key is sensitive
      const isSensitive = SENSITIVE_KEYS.some((sensitive) =>
        key.toLowerCase().includes(sensitive)
      );

      if (isSensitive && typeof value === 'string' && value.length > 0) {
        // Redact: show first 3 chars + last 4 chars
        if (value.length > 7) {
          redacted[key] = `${value.slice(0, 3)}***${value.slice(-4)}`;
        } else {
          redacted[key] = '***';
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively redact nested objects
        redacted[key] = this.redactSensitiveArgs(value);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  /**
   * Close audit log
   */
  async close(): Promise<void> {
    if (this.logStream) {
      await this.logStream.close();
      this.logStream = undefined;
      this.logger.debug('Audit log closed');
    }
  }
}
