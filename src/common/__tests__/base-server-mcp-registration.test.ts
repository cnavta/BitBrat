/**
 * Sprint 27: Test MCP registration variable reference preservation
 *
 * Security fix: Ensure MCP_AUTH_TOKEN is sent as variable reference
 * (${MCP_AUTH_TOKEN}) instead of resolved value, preventing token
 * exposure in service_registry database.
 */

import { Bit } from '../base-server';

describe('Bit MCP Registration - Variable Reference Preservation', () => {
  let mockPublishJson: jest.Mock;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCreatePublisher: any;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set test token
    process.env.MCP_AUTH_TOKEN = 'test-secret-token-12345';
    process.env.NATS_URL = 'nats://localhost:4222';

    // Mock message publisher at module level
    mockPublishJson = jest.fn().mockResolvedValue(undefined);
    const mockPub = { publishJson: mockPublishJson };

    // Save original and replace
    const messageBus = require('../../services/message-bus');
    originalCreatePublisher = messageBus.createMessagePublisher;
    messageBus.createMessagePublisher = jest.fn(() => mockPub);
  });

  afterEach(async () => {
    // Restore original env
    process.env = originalEnv;

    // Restore original createMessagePublisher
    if (originalCreatePublisher) {
      const messageBus = require('../../services/message-bus');
      messageBus.createMessagePublisher = originalCreatePublisher;
    }

    jest.clearAllMocks();
  });

  it('should send variable reference ${MCP_AUTH_TOKEN}, not resolved value', async () => {
    const testBit = new Bit({
      serviceName: 'test-service',
      mcpExposure: 'platform-only',
    });

    // Trigger publishRegistration (normally called during start)
    await (testBit as any).publishRegistration();
    await testBit.close('test-cleanup');

    // Verify publishJson was called
    expect(mockPublishJson).toHaveBeenCalledTimes(1);

    // Get the registration event payload
    const callArgs = mockPublishJson.mock.calls[0];
    const registrationEvent = callArgs[0];
    const payload = registrationEvent.payload;

    // CRITICAL: env.Authorization should contain variable reference, NOT resolved value
    expect(payload.env).toBeDefined();
    expect(payload.env.Authorization).toBe('Bearer ${MCP_AUTH_TOKEN}');

    // SECURITY CHECK: Should NOT contain actual token value
    expect(payload.env.Authorization).not.toContain('test-secret-token-12345');
  });

  it('should omit env when MCP_AUTH_TOKEN is not set', async () => {
    delete process.env.MCP_AUTH_TOKEN;

    const testBit = new Bit({
      serviceName: 'test-service-no-auth',
      mcpExposure: 'platform-only',
    });

    await (testBit as any).publishRegistration();
    await testBit.close('test-cleanup');

    const callArgs = mockPublishJson.mock.calls[0];
    const registrationEvent = callArgs[0];
    const payload = registrationEvent.payload;

    // env should be empty object when no token
    expect(payload.env).toEqual({});
  });

  it('should include other registration metadata correctly', async () => {
    const testBit = new Bit({
      serviceName: 'test-service-metadata',
      mcpExposure: 'platform+domain',
    });

    await (testBit as any).publishRegistration();
    await testBit.close('test-cleanup');

    const callArgs = mockPublishJson.mock.calls[0];
    const registrationEvent = callArgs[0];
    const payload = registrationEvent.payload;

    // Verify other metadata is correct
    expect(payload.name).toBe('test-service-metadata');
    expect(payload.transport).toBe('sse');
    expect(payload.status).toBe('active');
    expect(payload.url).toContain('test-service-metadata.bitbrat.local');
  });
});
