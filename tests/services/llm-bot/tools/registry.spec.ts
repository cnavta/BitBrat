import { ToolRegistry } from '../../../../src/services/llm-bot/tools/registry';
import { BitBratTool } from '../../../../src/types/tools';
import { z } from 'zod';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register and retrieve a tool', () => {
    const tool: BitBratTool = {
      id: 'test-tool',
      source: 'internal',
      description: 'A test tool',
      inputSchema: z.object({ arg: z.string() }),
      execute: async ({ arg }: { arg: string }) => `Hello ${arg}`,
    };

    registry.registerTool(tool);
    expect(registry.getTool('test-tool')).toBe(tool);
  });

  it('should unregister a tool', () => {
    const tool: BitBratTool = {
      id: 'test-tool',
      source: 'internal',
      inputSchema: z.object({}),
      execute: async () => 'test',
    };

    registry.registerTool(tool);
    registry.unregisterTool('test-tool');
    expect(registry.getTool('test-tool')).toBeUndefined();
  });

  it('should return all tools as a record', () => {
    const tool1: BitBratTool = {
      id: 'tool1',
      source: 'internal',
      inputSchema: z.object({}),
      execute: async () => '1',
    };
    const tool2: BitBratTool = {
      id: 'tool2',
      source: 'mcp',
      inputSchema: z.object({}),
      execute: async () => '2',
    };

    registry.registerTool(tool1);
    registry.registerTool(tool2);

    const tools = registry.getTools();
    expect(Object.keys(tools)).toHaveLength(2);
    expect(tools['tool1']).toBe(tool1);
    expect(tools['tool2']).toBe(tool2);
  });

  it('should sanitize tool names in getTools', () => {
    const tool: BitBratTool = {
      id: 'mcp-server:my-tool',
      source: 'mcp',
      inputSchema: z.object({}),
      execute: async () => 'test',
    };

    registry.registerTool(tool);
    const tools = registry.getTools();
    expect(tools['mcp-server_my-tool']).toBe(tool);
  });
});
