/**
 * Tool Gateway Interface
 * Sprint 58: Model-Based RBAC - Dual-Layer Validation & Context Propagation
 *
 * Central orchestrator for tool execution with dual-layer RBAC enforcement.
 */

import { ToolExecutionContext } from '../../../../types/tools';
import { RBACValidationResult } from './rbac-validator';

/**
 * Tool execution result
 */
export interface ToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Tool Gateway Interface
 * Coordinates tool execution with RBAC validation, routing, and logging
 */
export interface IToolGateway {
  /**
   * Execute a tool with dual-layer RBAC enforcement
   *
   * @param toolId Tool identifier
   * @param args Tool arguments
   * @param context Execution context (user roles, model ID, etc.)
   * @returns Tool execution result
   * @throws Error if tool not found or RBAC denies access
   */
  execute(
    toolId: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  /**
   * Validate tool access for a user and model (dual-layer RBAC)
   *
   * @param toolId Tool identifier
   * @param userId User identifier
   * @param modelId Model identifier
   * @param userRoles User roles
   * @returns Validation result with allowed flag and optional reason/details
   */
  validateToolAccess(
    toolId: string,
    userId: string,
    modelId: string,
    userRoles: string[]
  ): Promise<RBACValidationResult>;

  /**
   * List tools available to a user and model (filtered by RBAC)
   *
   * @param userId User identifier
   * @param modelId Model identifier
   * @param userRoles User roles
   * @returns Array of tool IDs accessible to the user and model
   */
  listAvailableTools(
    userId: string,
    modelId: string,
    userRoles: string[]
  ): Promise<string[]>;

  /**
   * Ensure MCP client connection for a server
   *
   * @param serverId MCP server identifier
   */
  ensureMcpClient(serverId: string): Promise<void>;

  /**
   * Disconnect MCP client for a server
   *
   * @param serverId MCP server identifier
   */
  disconnectMcpClient(serverId: string): Promise<void>;
}
