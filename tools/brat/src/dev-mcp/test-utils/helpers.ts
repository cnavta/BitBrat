/**
 * Test helper functions for dev-mcp testing
 *
 * Provides utility functions to simplify common test operations:
 * - Server setup/teardown
 * - Tool invocation testing
 * - Assertion helpers
 */

import { DevMcpServer } from '../server.js';
import { ToolRouter } from '../tool-router.js';
import { TargetConnectionManager } from '../target-manager.js';
import { createLogger } from '../../orchestration/logger';
import { TargetConnection } from '../types.js';
import { createMockConnection } from './mocks.js';

/**
 * Create a test MCP server instance
 */
export function createTestServer(options: {
  target?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  auditLogPath?: string;
} = {}): DevMcpServer {
  const server = new DevMcpServer({
    target: options.target || 'test',
    logLevel: options.logLevel || 'error', // Quiet during tests
    auditLogPath: options.auditLogPath || '.brat/test-audit.log',
  });

  return server;
}

/**
 * Create a test tool router instance
 */
export function createTestToolRouter(): {
  router: ToolRouter;
  targetManager: TargetConnectionManager;
} {
  const logger = createLogger({
    base: { component: 'test' },
    level: 'error', // Quiet during tests
  });

  const targetManager = new TargetConnectionManager(undefined, undefined, logger);
  const router = new ToolRouter(targetManager, logger);

  return { router, targetManager };
}

/**
 * Create a test target connection manager
 */
export function createTestTargetManager(defaultTarget?: string, authToken?: string): TargetConnectionManager {
  const logger = createLogger({
    base: { component: 'test' },
    level: 'error',
  });

  return new TargetConnectionManager(defaultTarget, authToken, logger);
}

/**
 * Helper to invoke a tool and get result
 */
export async function invokeTool(
  router: ToolRouter,
  name: string,
  args: Record<string, any> = {},
  connection?: TargetConnection
): Promise<any> {
  const conn = connection || createMockConnection();
  const result = await router.callTool(name, args, conn);
  return result;
}

/**
 * Helper to extract text content from MCP CallToolResult
 */
export function extractTextContent(result: any): string {
  if (!result.content || !Array.isArray(result.content)) {
    return '';
  }

  const textContent = result.content.find((c: any) => c.type === 'text');
  return textContent ? textContent.text : '';
}

/**
 * Helper to parse JSON from MCP text content
 */
export function parseJsonContent(result: any): any {
  const text = extractTextContent(result);
  return text ? JSON.parse(text) : null;
}

/**
 * Helper to assert MCP result is successful (no isError flag)
 */
export function assertSuccess(result: any): void {
  if (result.isError) {
    const errorText = extractTextContent(result);
    throw new Error(`Tool call failed: ${errorText}`);
  }
}

/**
 * Helper to assert MCP result is an error
 */
export function assertError(result: any, expectedMessage?: string): void {
  if (!result.isError) {
    throw new Error('Expected tool call to fail but it succeeded');
  }

  if (expectedMessage) {
    const errorText = extractTextContent(result);
    if (!errorText.includes(expectedMessage)) {
      throw new Error(
        `Expected error to contain "${expectedMessage}" but got: ${errorText}`
      );
    }
  }
}

/**
 * Helper to create a mock audit log path for testing
 */
export function createTestAuditLogPath(): string {
  const timestamp = Date.now();
  return `.brat/test-audit-${timestamp}.log`;
}

/**
 * Helper to wait for async operations to complete
 */
export async function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to suppress console output during tests
 */
export function suppressConsole(): {
  restore: () => void;
} {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();

  return {
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

/**
 * Helper to create a spy on logger methods
 */
export function spyOnLogger(logger: any): {
  info: jest.SpyInstance;
  error: jest.SpyInstance;
  warn: jest.SpyInstance;
  debug: jest.SpyInstance;
} {
  return {
    info: jest.spyOn(logger, 'info'),
    error: jest.spyOn(logger, 'error'),
    warn: jest.spyOn(logger, 'warn'),
    debug: jest.spyOn(logger, 'debug'),
  };
}
