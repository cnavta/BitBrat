import { z } from 'zod';

export type ToolSource = 'internal' | 'mcp' | 'firestore';

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
  execute?: (args: z.infer<PARAMETERS>) => Promise<RESULT>;
  /** Optional roles required to use this tool (RBAC) */
  requiredRoles?: string[];
}

/**
 * Interface for registering tools
 */
export interface IToolRegistry {
  registerTool(tool: BitBratTool): void;
  unregisterTool(id: string): void;
  getTools(): Record<string, BitBratTool>;
  getTool(id: string): BitBratTool | undefined;
}
