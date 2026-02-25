import { ToolRegistry } from './src/services/llm-bot/tools/registry';
import { BitBratTool } from './src/types/tools';
import { z } from 'zod';

async function testLimit() {
  const registry = new ToolRegistry();
  for (let i = 0; i < 10; i++) {
    const tool: BitBratTool = {
      id: `tool-${i}`,
      source: 'mcp',
      displayName: `Tool ${i}`,
      description: `Description ${i}`,
      inputSchema: z.object({}),
      execute: async () => `Result ${i}`,
    };
    registry.registerTool(tool);
  }

  const tools = registry.getTools();
  console.log(`Registered tools count: ${Object.keys(tools).length}`);
  for (const name of Object.keys(tools)) {
      console.log(`Tool: ${name} -> ${tools[name].id}`);
  }
}

testLimit().catch(console.error);
