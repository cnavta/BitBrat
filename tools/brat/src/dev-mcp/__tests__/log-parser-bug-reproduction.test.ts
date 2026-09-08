/**
 * Bug Reproduction Test - Sprint 46
 *
 * This test reproduces the critical bug where error logs are silently dropped
 * by the parseDockerLogLine function.
 *
 * Incident: llm-bot error log (correlationId: d75e7c4c-dcb5-4d5f-870f-6081a7e66df8)
 * was present in Docker logs but missing from fleet.logs output.
 */

import { parseDockerLogLine, normalizeLevel } from '../log-parser';

describe('Bug Reproduction - Missing Error Logs (Sprint 46)', () => {
  // Exact log line from staging that was dropped
  const errorLogLine = 'llm-bot-1 | {"ts":"2026-09-07T22:45:31.975Z","service":"llm-bot","level":"error","severity":"ERROR","msg":"llm_bot.tool_error","tool":"mcp:grockle","error":"MCP Tool Error: [{\\"type\\":\\"text\\",\\"text\\":\\"Composition execution failed: Tool execution failed: mcp:generate_image\\"}]","correlationId":"d75e7c4c-dcb5-4d5f-870f-6081a7e66df8","traceId":"276b0e90-49fc-4a38-97cd-4ac89f5847ba","userId":"twitch:91960688","stage":"reaction"}';

  it('should parse the error log line that was previously dropped', () => {
    const result = parseDockerLogLine(errorLogLine, 'llm-bot');

    // Bug: This was returning null, causing the error log to be dropped
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it('should extract correct fields from the error log', () => {
    const result = parseDockerLogLine(errorLogLine, 'llm-bot');

    expect(result).toMatchObject({
      timestamp: '2026-09-07T22:45:31.975Z',
      level: 'error',
      service: 'llm-bot',
      msg: 'llm_bot.tool_error',
      correlationId: 'd75e7c4c-dcb5-4d5f-870f-6081a7e66df8'
    });
  });

  it('should handle uppercase severity values', () => {
    // The bug may be related to severity="ERROR" (uppercase) not normalizing correctly
    expect(normalizeLevel('ERROR')).toBe('error');
    expect(normalizeLevel('WARN')).toBe('warn');
    expect(normalizeLevel('INFO')).toBe('info');
    expect(normalizeLevel('DEBUG')).toBe('debug');
  });

  it('should handle logs with both level and severity fields', () => {
    const logWithBothFields = 'llm-bot-1 | {"ts":"2026-09-07T22:45:31.975Z","level":"error","severity":"ERROR","msg":"test"}';
    const result = parseDockerLogLine(logWithBothFields, 'llm-bot');

    expect(result).not.toBeNull();
    expect(result?.level).toBe('error');
  });

  it('should handle logs with only severity field (uppercase)', () => {
    const logWithOnlySeverity = 'llm-bot-1 | {"ts":"2026-09-07T22:45:31.975Z","severity":"ERROR","msg":"test"}';
    const result = parseDockerLogLine(logWithOnlySeverity, 'llm-bot');

    expect(result).not.toBeNull();
    expect(result?.level).toBe('error');
  });
});
