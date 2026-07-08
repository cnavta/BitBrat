/**
 * Tool Router
 *
 * Registers and dispatches MCP tool calls.
 * Validates arguments against schemas and handles errors.
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ToolDefinition, TargetConnection, ToolHandler } from './types.js';
import { TargetConnectionManager } from './target-manager.js';
import { Logger } from '../orchestration/logger';

/**
 * Manages tool registration and dispatch
 */
export class ToolRouter {
  private tools: Map<string, ToolDefinition> = new Map();
  private targetManager: TargetConnectionManager;
  private logger: Logger;

  constructor(targetManager: TargetConnectionManager, logger: Logger) {
    this.targetManager = targetManager;
    this.logger = logger;
  }

  /**
   * Register a tool
   */
  registerTool(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }

    this.tools.set(definition.name, definition);
    this.logger.debug({ name: definition.name }, 'Tool registered');
  }

  /**
   * List all registered tools (MCP format)
   */
  listTools(): Tool[] {
    const tools: any[] = [];
    for (const def of this.tools.values()) {
      // @ts-ignore - zodToJsonSchema can cause deep type instantiation errors
      const schema = zodToJsonSchema(def.inputSchema);
      tools.push({
        name: def.name,
        description: def.description,
        inputSchema: schema,
      });
    }
    return tools as Tool[];
  }

  /**
   * Call a tool by name
   */
  async callTool(
    name: string,
    args: Record<string, any>,
    connection: TargetConnection
  ): Promise<CallToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Validate arguments
    try {
      const validatedArgs = tool.inputSchema.parse(args);

      // Call handler
      return await tool.handler(validatedArgs, connection);
    } catch (error: any) {
      // Schema validation error or handler error
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid arguments for tool '${name}': ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get registered tool count
   */
  getToolCount(): number {
    return this.tools.size;
  }
}
