import { StoryEngineMcpServer } from '../story-engine-mcp';

describe('StoryEngineMcpServer', () => {
  let server: StoryEngineMcpServer;

  beforeAll(() => {
    // Avoid starting the actual server on a port during tests
    server = new StoryEngineMcpServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('should be defined', () => {
    expect(server).toBeDefined();
  });

  it('should have health endpoint', () => {
      const app = (server as any).getApp();
      expect(app).toBeDefined();
  });
  
  it('should have registered MCP tools', () => {
      const tools = (server as any).registeredTools;
      expect(tools.has('start_story')).toBe(true);
      expect(tools.has('get_current_scene')).toBe(true);
      expect(tools.has('process_action')).toBe(true);
      expect(tools.has('update_world_state')).toBe(true);
  });
});
