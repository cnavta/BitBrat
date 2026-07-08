/**
 * Tests for DevMcpServer
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DevMcpServer } from '../server.js';
import { createTestServer, createTestAuditLogPath } from '../test-utils/helpers.js';

describe('DevMcpServer', () => {
  let server: DevMcpServer;

  beforeEach(() => {
    // Set up test environment
  });

  afterEach(async () => {
    if (server) {
      await server.shutdown();
    }
  });

  it('should initialize with default options', () => {
    server = new DevMcpServer();
    expect(server).toBeDefined();
  });

  it('should initialize with custom options', () => {
    server = createTestServer({
      target: 'test-target',
      logLevel: 'debug',
      auditLogPath: createTestAuditLogPath(),
    });
    expect(server).toBeDefined();
  });

  it('should expose tool router', () => {
    server = new DevMcpServer();
    const router = server.getToolRouter();
    expect(router).toBeDefined();
    expect(typeof router.registerTool).toBe('function');
    expect(typeof router.listTools).toBe('function');
  });

  // TODO: DM-007 - Add comprehensive tests
  // These tests require starting the server which creates stdio transport.
  // For unit tests, we'll need to refactor to inject transport or use integration tests.
  //
  // Tests to add:
  // - MCP protocol compliance (initialize, tools/list, tools/call)
  // - Error handling
  // - Audit logging integration
  //
  // Example test structure:
  // it('should handle tools/list request', async () => {
  //   server = createTestServer();
  //   // Register a test tool
  //   server.getToolRouter().registerTool({...});
  //   // Mock MCP request/response
  //   // const tools = await server.handleListTools();
  //   // expect(tools).toHaveLength(1);
  // });
});
