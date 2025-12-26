import { McpClientManager } from '../../../../src/services/llm-bot/mcp/client-manager';
import { ToolRegistry } from '../../../../src/services/llm-bot/tools/registry';

describe('Web Search MCP Integration', () => {
  let mockServer: any;
  let registry: ToolRegistry;
  let manager: McpClientManager;

  beforeEach(() => {
    mockServer = {
      getConfig: jest.fn(),
      getLogger: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    };
    registry = new ToolRegistry();
    manager = new McpClientManager(mockServer, registry);
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it('should discover web-search tools from the installed package', async () => {
    const config = {
      name: 'web-search',
      command: 'node',
      args: ['./node_modules/@guhcostan/web-search-mcp/dist/server.js']
    };

    await manager.connectServer(config);

    const tools = registry.getTools();
    console.log('mcp_search_web schema:', JSON.stringify(tools.mcp_search_web.inputSchema, null, 2));
    
    // The ToolRegistry replaces ':' with '_'
    expect(tools).toHaveProperty('mcp_search_web');
    expect(tools).toHaveProperty('mcp_fetch_page');
    
    expect(tools.mcp_search_web.description).toContain('Search the web');
    expect(tools.mcp_fetch_page.description).toContain('Fetch a page');
  });
});
