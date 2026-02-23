import { z } from 'zod';

import { ReadResourceResult, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

export type ToolSource = 'internal' | 'mcp' | 'firestore';

/**
 * Context provided during tool execution
 */
export interface ToolExecutionContext {
  /** Roles associated with the requesting user */
  userRoles: string[];
  /** Optional user ID of the requesting user */
  userId?: string;
  /** Optional name of the requesting agent */
  agentName?: string;
  /** Optional correlation ID for the request */
  correlationId?: string;
}

/**
 * Extended AI SDK Tool interface for BitBrat
 */
export interface BitBratTool<PARAMETERS extends z.ZodTypeAny = any, RESULT = any> {
  /** Unique ID for the tool (e.g. mcp-server-name:tool-name) */
  id: string;
  /** Source of the tool */
  source: ToolSource;
  /** Human-friendly name (optional) */
  displayName?: string;
  /** Tool description for the LLM */
  description?: string;
  /** Zod schema for the tool parameters */
  inputSchema: PARAMETERS;
  /** Execution logic */
  execute?: (args: z.infer<PARAMETERS>, context: ToolExecutionContext) => Promise<RESULT>;
  /** Optional roles required to use this tool (RBAC) */
  requiredRoles?: string[];
  /** Optional agents allowed to use this tool (RBAC) */
  agentAllowlist?: string[];
  /** Optional origin server name for this tool */
  originServer?: string;
}

/**
 * Extended AI SDK Resource interface for BitBrat
 */
export interface BitBratResource {
  /** Unique URI for the resource */
  uri: string;
  /** Human-friendly name */
  name: string;
  /** Resource description */
  description?: string;
  /** MIME type of the resource content */
  mimeType?: string;
  /** Source of the resource */
  source: ToolSource;
  /** Optional roles required to read this resource (RBAC) */
  requiredRoles?: string[];
  /** Optional agents allowed to read this resource (RBAC) */
  agentAllowlist?: string[];
  /** Optional origin server name for this resource */
  originServer?: string;
  /** Execution logic for reading the resource */
  read?: (context?: ToolExecutionContext) => Promise<ReadResourceResult>;
}

/**
 * Extended AI SDK Prompt interface for BitBrat
 */
export interface BitBratPrompt {
  /** Unique ID for the prompt */
  id: string;
  /** Human-friendly name */
  name: string;
  /** Prompt description */
  description?: string;
  /** Prompt arguments */
  arguments?: { name: string; description?: string; required?: boolean }[];
  /** Source of the prompt */
  source: ToolSource;
  /** Optional roles required to use this prompt (RBAC) */
  requiredRoles?: string[];
  /** Optional agents allowed to use this prompt (RBAC) */
  agentAllowlist?: string[];
  /** Optional origin server name for this prompt */
  originServer?: string;
  /** Execution logic for getting the prompt */
  get?: (args: Record<string, string>, context?: ToolExecutionContext) => Promise<GetPromptResult>;
}

/**
 * Interface for registering tools, resources, and prompts
 */
export interface IToolRegistry {
  registerTool(tool: BitBratTool): void;
  unregisterTool(id: string): void;
  getTools(): Record<string, BitBratTool>;
  getTool(id: string): BitBratTool | undefined;

  registerResource(resource: BitBratResource): void;
  unregisterResource(uri: string): void;
  getResources(): Record<string, BitBratResource>;
  getResource(uri: string): BitBratResource | undefined;

  registerPrompt(prompt: BitBratPrompt): void;
  unregisterPrompt(id: string): void;
  getPrompts(): Record<string, BitBratPrompt>;
  getPrompt(id: string): BitBratPrompt | undefined;
}
