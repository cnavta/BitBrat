import { BitBratTool } from '../../../types/tools';
import { jsonSchema } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

export class McpBridge {
  constructor(private client: Client) {}

  /**
   * Translates an MCP tool definition into a BitBratTool.
   */
  translateTool(mcpTool: { name: string; description?: string; inputSchema: any }): BitBratTool {
    return {
      id: `mcp:${mcpTool.name}`,
      source: 'mcp',
      displayName: mcpTool.name,
      description: mcpTool.description,
      // Use jsonSchema helper from AI SDK to support raw JSON Schema
      inputSchema: jsonSchema(mcpTool.inputSchema),
      execute: async (args: any) => {
        const result = await this.client.callTool({
          name: mcpTool.name,
          arguments: args,
        }, CallToolResultSchema);

        if (result.isError) {
          throw new Error(`MCP Tool Error: ${JSON.stringify(result.content)}`);
        }

        // Return the first text content or a summary of the content
        const content = result.content as any[];
        const textParts = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text);
        
        return textParts.join('\n');
      },
    };
  }
}
