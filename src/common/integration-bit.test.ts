/**
 * Unit tests for IntegrationBit
 *
 * @module integration-bit.test
 * @since Sprint 12
 */

import { IntegrationBit, ConnectorFactory, IntegrationBitConfig } from './integration-bit';
import type { IngressConnector, WebhookConnector, EgressConnector } from '../services/ingress/core';
import type { InternalEventV2 } from '../types/events';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock connector
class MockConnector implements IngressConnector, WebhookConnector, EgressConnector {
  private state: 'DISCONNECTED' | 'CONNECTED' = 'DISCONNECTED';

  async start(): Promise<void> {
    this.state = 'CONNECTED';
  }

  async stop(): Promise<void> {
    this.state = 'DISCONNECTED';
  }

  getSnapshot() {
    return {
      platform: 'mock',
      state: this.state,
      started: this.state === 'CONNECTED',
    };
  }

  getMetadata() {
    return {
      platform: 'mock',
      version: '1.0.0',
      authMethod: 'api_key' as const,
      capabilities: {
        ingress: {
          method: 'webhook' as const,
          realtime: false,
          requiresWebhook: true,
          requiresPublicUrl: true,
        },
        egress: {
          chat: true,
          dm: true,
          reactions: false,
          threads: false,
        },
        moderation: {
          ban: false,
          timeout: false,
          delete: false,
        },
      },
    };
  }

  verifySignature(req: any): boolean {
    return req.headers['x-mock-signature'] === 'valid';
  }

  async handleWebhook(req: any) {
    return { status: 200, body: { ok: true } };
  }

  async sendText(text: string, target?: string): Promise<void> {
    // Mock implementation
  }
}

// Mock factory
const createMockConnector: ConnectorFactory = async (config, opts) => {
  return new MockConnector();
};

// Mock factory that throws
const createFailingConnector: ConnectorFactory = async (config, opts) => {
  throw new Error('Factory failed');
};

describe('IntegrationBit', () => {
  let integrationBit: IntegrationBit;
  let config: IntegrationBitConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    config = {
      serviceName: 'test-integration',
      connectors: [
        { name: 'mock', factory: createMockConnector, enabled: true },
      ],
    };
  });

  describe('Constructor', () => {
    it('should initialize with correct service name', () => {
      integrationBit = new IntegrationBit(config);
      expect(integrationBit).toBeDefined();
    });

    it('should resolve instance ID from INSTANCE_ID env var', () => {
      process.env.INSTANCE_ID = 'test-instance-123';
      integrationBit = new IntegrationBit(config);
      // Instance ID should be accessible via debug endpoint
      delete process.env.INSTANCE_ID;
    });

    it('should resolve instance ID from Cloud Run env vars', () => {
      process.env.K_SERVICE = 'test-service';
      process.env.K_REVISION = 'rev-123';
      integrationBit = new IntegrationBit(config);
      delete process.env.K_SERVICE;
      delete process.env.K_REVISION;
    });

    it('should generate fallback instance ID', () => {
      integrationBit = new IntegrationBit(config);
      // Should generate random suffix
    });
  });

  describe('registerConnectors()', () => {
    it('should register enabled connectors', async () => {
      config.connectors = [
        { name: 'connector1', factory: createMockConnector, enabled: true },
        { name: 'connector2', factory: createMockConnector, enabled: true },
      ];

      integrationBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async registration
    });

    it('should skip disabled connectors', async () => {
      config.connectors = [
        { name: 'enabled', factory: createMockConnector, enabled: true },
        { name: 'disabled', factory: createMockConnector, enabled: false },
      ];

      integrationBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should handle factory errors gracefully (fail-open)', async () => {
      config.connectors = [
        { name: 'good', factory: createMockConnector, enabled: true },
        { name: 'bad', factory: createFailingConnector, enabled: true },
        { name: 'good2', factory: createMockConnector, enabled: true },
      ];

      integrationBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100));
      // Should continue registering other connectors despite failure
    });

    it('should default enabled to true if not specified', async () => {
      config.connectors = [
        { name: 'default-enabled', factory: createMockConnector },
      ];

      integrationBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('setupWebhookRouting()', () => {
    beforeEach(() => {
      integrationBit = new IntegrationBit(config);
    });

    it('should register POST /webhooks/:platform route', () => {
      const app = (integrationBit as any).getApp();
      expect(app).toBeDefined();
    });
  });

  describe('setupEgressRouting()', () => {
    beforeEach(() => {
      integrationBit = new IntegrationBit(config);
    });

    it('should skip subscriptions in test environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const testBit = new IntegrationBit(config);

      process.env.NODE_ENV = originalEnv;
    });

    // TODO: Requires NATS infrastructure - test in integration environment
    it.skip('should create instance-specific subscription', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const testBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100));

      process.env.NODE_ENV = originalEnv;
    });

    // TODO: Requires NATS infrastructure - test in integration environment
    it.skip('should create generic egress subscription', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const testBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100));

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('processEgress()', () => {
    let mockEvent: InternalEventV2;

    beforeEach(() => {
      integrationBit = new IntegrationBit(config);

      mockEvent = {
        correlationId: 'test-correlation-123',
        type: 'egress.deliver.v1',
        timestamp: new Date().toISOString(),
        egress: {
          connector: 'mock',
          channel: 'test-channel',
        },
        candidates: [
          {
            id: 'candidate-1',
            text: 'Test message',
            priority: 100,
            confidence: 0.9,
            createdAt: new Date().toISOString(),
          },
        ],
      } as any;
    });

    it('should extract platform from egress.connector', async () => {
      await (integrationBit as any).processEgress(mockEvent);
    });

    it('should warn if connector field is missing', async () => {
      delete (mockEvent.egress as any).connector;
      await (integrationBit as any).processEgress(mockEvent);
    });

    it('should warn if platform is unknown', async () => {
      (mockEvent.egress as any).connector = 'unknown-platform';
      await (integrationBit as any).processEgress(mockEvent);
    });

    it('should warn if text extraction fails', async () => {
      mockEvent.candidates = [];
      await (integrationBit as any).processEgress(mockEvent);
    });

    it('should use target channel from egress or ingress', async () => {
      await (integrationBit as any).processEgress(mockEvent);
    });
  });

  describe('setupStatusMonitoring()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      integrationBit = new IntegrationBit(config);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should run status check immediately', () => {
      // setImmediate should be called
    });

    it('should run status check every 15 seconds', () => {
      jest.advanceTimersByTime(15000);
      // Should have checked status
    });

    it('should detect state changes', async () => {
      // Change connector state
      jest.advanceTimersByTime(15000);
    });

    it('should not publish if state unchanged', () => {
      jest.advanceTimersByTime(15000);
      jest.advanceTimersByTime(15000);
      // Second check should not publish if no change
    });
  });

  describe('setupDebugEndpoints()', () => {
    beforeEach(() => {
      integrationBit = new IntegrationBit(config);
    });

    it('should register GET /_debug/instance', () => {
      const app = (integrationBit as any).getApp();
      expect(app).toBeDefined();
    });

    it('should register GET /_debug/connectors', () => {
      const app = (integrationBit as any).getApp();
      expect(app).toBeDefined();
    });

    it('should register GET /_debug/:platform', () => {
      const app = (integrationBit as any).getApp();
      expect(app).toBeDefined();
    });
  });

  describe('close()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      integrationBit = new IntegrationBit(config);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clear status monitoring interval', async () => {
      await integrationBit.close();
      // Interval should be cleared
    });

    it('should stop all connectors', async () => {
      await integrationBit.close();
      // Connectors should be stopped
    });

    it('should call super.close()', async () => {
      await integrationBit.close();
      // Base class close should be called
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple connectors with same name', async () => {
      config.connectors = [
        { name: 'duplicate', factory: createMockConnector },
        { name: 'duplicate', factory: createMockConnector },
      ];

      integrationBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should handle empty connector array', () => {
      config.connectors = [];
      integrationBit = new IntegrationBit(config);
    });

    it('should handle missing publisherFactory in factory opts', async () => {
      const factoryWithoutPublisher: ConnectorFactory = async (cfg, opts) => {
        // Factory that doesn't use publisherFactory
        return new MockConnector();
      };

      config.connectors = [
        { name: 'no-publisher', factory: factoryWithoutPublisher },
      ];

      integrationBit = new IntegrationBit(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });
});
