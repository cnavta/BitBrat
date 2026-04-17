import { z } from 'zod';
import { BitBratTool, ToolExecutionContext } from '../../../types/tools';

/**
 * Tool: get_current_time
 * Returns the current time and date in ISO 8601 format and local timezone information.
 */
export function createGetCurrentTimeTool(): BitBratTool {
  return {
    id: 'basic:get_current_time',
    source: 'internal',
    displayName: 'Get Current Time',
    description: 'Returns the current time and date in ISO 8601 format and local timezone information.',
    inputSchema: z.object({}),
    execute: async (_args: any, _context: ToolExecutionContext) => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        timestamp: now.getTime(),
        timezoneOffset: now.getTimezoneOffset(),
        localString: now.toLocaleString(),
        timezoneName: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    }
  };
}
