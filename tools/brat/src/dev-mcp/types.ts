/**
 * Shared types for dev-mcp server
 */

import { Firestore } from 'firebase-admin/firestore';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * Target connection representing a resolved deployment target
 */
export interface TargetConnection {
  /** Target name from architecture.yaml */
  name: string;
  /** Target type */
  type: 'local' | 'remote-ssh' | 'gcp';
  /** Firestore connection options */
  firestore: {
    db: Firestore;
    projectId: string;
    databaseId?: string;
  };
  /** Optional gateway URL for fleet operations */
  gateway?: {
    url: string;
    authToken?: string;
  };
  /** SSH connection details (for remote-ssh type) */
  ssh?: {
    /** SSH target (user@host) */
    target: string;
    /** Remote working directory */
    remoteDir?: string;
  };
  /** Cleanup function to close connections/tunnels */
  cleanup: () => Promise<void>;
}

/**
 * Tool handler function signature
 */
export type ToolHandler = (
  args: Record<string, any>,
  connection: TargetConnection
) => Promise<CallToolResult>;

/**
 * Tool definition for registration
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: ToolHandler;
}

/**
 * Dev MCP server options
 */
export interface DevMcpServerOptions {
  /** Default target name */
  target?: string;
  /** Log level */
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  /** Audit log path */
  auditLogPath?: string;
  /** Authentication token */
  authToken?: string;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  timestamp: string;
  tool: string;
  args: Record<string, any>;
  target: string;
  identity?: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Deployment type for a Bit (determines log retrieval strategy)
 */
export type DeploymentType = 'cloud-run' | 'docker';

/**
 * Log level for filtering
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Log output format
 */
export type LogFormat = 'text' | 'json' | 'raw';

/**
 * Trace output format
 */
export type TraceFormat = 'text' | 'json' | 'timeline';

/**
 * Log request parameters
 */
export interface LogRequest {
  /** Bit name to query logs from (omit for all) */
  bit?: string;
  /** Log levels to include (if empty, all levels) */
  level?: LogLevel[];
  /** Start time (ISO timestamp or duration like "1h", "30m") */
  since?: string;
  /** End time (ISO timestamp) */
  until?: string;
  /** Maximum number of log entries to return */
  limit?: number;
  /** Filter by correlation ID */
  correlationId?: string;
  /** Output format */
  format?: LogFormat;
  /** Stream logs in real-time (future) */
  follow?: boolean;
  /** Target connection */
  target?: string;
}

/**
 * Single log entry
 */
export interface LogEntry {
  /** Timestamp (ISO format) */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Service/Bit name */
  service?: string;
  /** Log message */
  message?: string;
  /** Alternative message field */
  msg?: string;
  /** Correlation ID (if present) */
  correlationId?: string;
  /** Additional context fields */
  [key: string]: any;
}

/**
 * Log response
 */
export interface LogResponse {
  /** Bit name */
  bit?: string;
  /** Target name */
  target: string;
  /** Total entries returned */
  count: number;
  /** Log entries */
  logs: LogEntry[];
  /** Deployment type used */
  deploymentType?: DeploymentType;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Trace request parameters
 */
export interface TraceRequest {
  /** Correlation ID to trace */
  correlationId: string;
  /** Output format */
  format?: TraceFormat;
  /** Target connection */
  target?: string;
}

/**
 * Timeline entry for distributed trace
 */
export interface TimelineEntry {
  /** Relative timestamp in milliseconds from trace start */
  relativeMs: number;
  /** Service/Bit name */
  service: string;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
}

/**
 * Trace timeline response
 */
export interface TraceTimeline {
  /** Correlation ID */
  correlationId: string;
  /** Total duration in milliseconds */
  duration: number;
  /** List of services involved */
  services: string[];
  /** Timeline entries sorted by timestamp */
  timeline: TimelineEntry[];
  /** Target name */
  target?: string;
}
