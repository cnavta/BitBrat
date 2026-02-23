import { BitBratTool } from '../../types/tools';
import { jsonSchema } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpStatsCollector } from './stats-collector';

export class McpBridge {
  constructor(
    private client: Client,
    private serverName: string,
    private stats?: McpStatsCollector
  ) {}

  /**
   * Translates an MCP tool definition into a BitBratTool.
   */
  translateTool(mcpTool: { name: string; description?: string; inputSchema: any }, requiredRoles?: string[]): BitBratTool {
    const toolId = `mcp:${mcpTool.name}`;

    // Defensive: Ensure inputSchema is an object and has a valid type
    let schema = mcpTool.inputSchema;
    if (!schema || typeof schema !== 'object') {
      schema = { type: 'object', properties: {} };
    } else if (schema.type === 'None') {
      // MCP Python servers sometimes output type: "None" for empty parameters
      schema = { ...schema, type: 'object' };
      if (!schema.properties) schema.properties = {};
    }

    return {
      id: toolId,
      source: 'mcp',
      displayName: mcpTool.name,
      description: mcpTool.description,
      // Use jsonSchema helper from AI SDK to support raw JSON Schema
      inputSchema: jsonSchema(schema),
      requiredRoles,
      execute: async (args: any, _context: any) => {
        const start = Date.now();
        let error = false;
        let responseSize = 0;
        try {
          const result = await this.client.callTool({
            name: mcpTool.name,
            arguments: args,
          }, CallToolResultSchema);

          if (result.isError) {
            error = true;
            throw new Error(`MCP Tool Error: ${JSON.stringify(result.content)}`);
          }

          // Return the first text content or a summary of the content
          const content = result.content as any[];
          const textParts = content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text);

          if (textParts.length > 0) {
            const response = textParts.join('\n').trim();
            if (response.length > 0) {
              responseSize = Buffer.byteLength(response, 'utf8');
              return response;
            }
          }

          // Fallback: If no text content (or only empty text parts), return the whole content object so it gets logged in prompt_logs
          const fallback = result.content;
          responseSize = Buffer.byteLength(JSON.stringify(fallback), 'utf8');
          return fallback;
        } catch (e) {
          error = true;
          throw e;
        } finally {
          const duration = Date.now() - start;
          if (this.stats) {
            this.stats.recordCall(this.serverName, toolId, duration, error, responseSize);
          }
        }
      },
    };
  }
}
