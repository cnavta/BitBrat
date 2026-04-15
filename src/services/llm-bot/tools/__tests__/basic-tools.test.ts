import { createGetCurrentTimeTool } from '../basic-tools';

describe('Basic Tools', () => {
  describe('get_current_time', () => {
    it('should return the current time and timezone information', async () => {
      const tool = createGetCurrentTimeTool();
      
      // Mock Date to have a fixed time
      const mockDate = new Date('2026-04-15T08:20:00Z');
      const spy = jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
      
      const result = await tool.execute!({}, { userRoles: [] });
      
      expect(result).toBeDefined();
      expect(result.iso).toBe('2026-04-15T08:20:00.000Z');
      expect(result.timestamp).toBe(mockDate.getTime());
      expect(result.timezoneName).toBeDefined();
      expect(result.localString).toBeDefined();
      
      spy.mockRestore();
    });

    it('should return a valid ISO string when not mocked', async () => {
        const tool = createGetCurrentTimeTool();
        const result = await tool.execute!({}, { userRoles: [] });
        
        expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});
