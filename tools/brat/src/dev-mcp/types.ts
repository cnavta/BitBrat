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
