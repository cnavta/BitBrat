/**
 * Tool Router
 *
 * Registers and dispatches MCP tool calls.
 * Validates arguments against schemas and handles errors.
 *
 * Sprint 38: Removed zodToJsonSchema conversion - Zod v4 implements Standard Schema v1 natively,
 * which MCP v2 supports directly. No conversion needed.
 */
import { Tool, CallToolResult } from "@modelcontextprotocol/server";
import { z } from 'zod';

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
   *
   * Sprint 38: Pass Zod schemas directly to MCP. Zod v4+ implements Standard Schema v1
   * natively via the `~standard` symbol property, which MCP v2 accepts without conversion.
   */
  listTools(): Tool[] {
    const tools: any[] = [];
    for (const def of this.tools.values()) {
      tools.push({
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema, // Zod schema passed directly
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

    // Preprocess arguments BEFORE validation (Sprint 44/45/46 fix)
    // MCP XML protocol serializes array parameters as JSON strings
    // Convert '["error", "warn"]' → ["error", "warn"] before Zod validation
    const preprocessedArgs = this.preprocessMCPArguments(args);

    // Validate arguments
    try {
      const validatedArgs = tool.inputSchema.parse(preprocessedArgs);

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
   * Preprocess MCP arguments to handle serialization quirks
   *
   * Sprint 44/45/46: MCP XML protocol serializes array parameters as JSON strings.
   * This preprocessing converts JSON string arrays to native arrays before schema validation.
   *
   * Example: '["error", "warn"]' → ["error", "warn"]
   */
  private preprocessMCPArguments(args: Record<string, any>): Record<string, any> {
    const preprocessed: Record<string, any> = {};

    for (const [key, value] of Object.entries(args)) {
      // Try to parse string values as JSON (handles array serialization)
      if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
        try {
          preprocessed[key] = JSON.parse(value);
        } catch {
          // Not valid JSON - keep original value
          preprocessed[key] = value;
        }
      } else {
        preprocessed[key] = value;
      }
    }

    return preprocessed;
  }

  /**
   * Get registered tool count
   */
  getToolCount(): number {
    return this.tools.size;
  }
}
