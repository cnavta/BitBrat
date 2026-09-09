/**
 * Unit tests for ApiGatewayClient
 *
 * Sprint 39: Dev MCP Messaging Tools
 * Task 1.7: Comprehensive unit tests for WebSocket client
 *
 * Test Coverage:
 * - Connection management
 * - Message sending
 * - Response correlation
 * - Timeout handling
 * - Error handling
 * - Cleanup
 */

import { ApiGatewayClient } from '../api-gateway-client';
import type { InternalEventV2 } from '../../../../../src/types/events';
import { EventEmitter } from 'events';
import { createLogger } from '../../orchestration/logger';

// Mock WebSocket instance storage
let mockWsInstance: any = null;

// Mock the ws module - this MUST be inline without external references due to hoisting
jest.mock('ws', () => {
  const { EventEmitter } = require('events');

  return jest.fn().mockImplementation((url: string, options?: any) => {
    class MockWebSocket extends EventEmitter {
      public readyState: number = 0; // CONNECTING
      public sent: string[] = [];
      public closeCalled: boolean = false;
      public url: string;
      public options: any;
      private openTimeout: any;

      constructor(url: string, options?: any) {
        super();
        this.url = url;
        this.options = options;
        // Store instance globally for test access
        mockWsInstance = this;
        // Simulate async connection (can be cancelled by error)
        this.openTimeout = setImmediate(() => {
          if (this.readyState === 0) { // Only open if still connecting
            this.readyState = 1; // OPEN
            this.emit('open');
          }
        });
      }

      send(data: string): void {
        this.sent.push(data);
      }

      close(): void {
        // Clear pending open if not yet opened
        if (this.openTimeout) {
          clearImmediate(this.openTimeout);
        }
        this.closeCalled = true;
        this.readyState = 3; // CLOSED
        this.emit('close');
      }

      // Simulate incoming message
      simulateMessage(data: any): void {
        const buffer = Buffer.from(JSON.stringify(data));
        this.emit('message', buffer);
      }

      // Simulate error
      simulateError(error: Error): void {
        // If error during connection, cancel the open
        if (this.readyState === 0 && this.openTimeout) {
          clearImmediate(this.openTimeout);
        }
        this.emit('error', error);
      }
    }

    return new MockWebSocket(url, options);
  });
});

// Get reference to the mocked constructor after mocking
const WebSocketMock = require('ws');
const MockWebSocketConstructor = WebSocketMock;

describe('ApiGatewayClient', () => {
  let client: ApiGatewayClient;
  let mockLogger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWsInstance = null;

    // Create mock logger with all methods
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      trace: jest.fn(),
      child: jest.fn(),
      level: 'info',
    } as any;
  });

  afterEach(async () => {
    if (client && client.isClientConnected()) {
      await client.disconnect();
    }
  });

  describe('Connection Management', () => {
    it('should connect with Bearer token', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        authToken: 'test-token',
        logger: mockLogger,
      });

      await client.connect();

      expect(client.isClientConnected()).toBe(true);
      expect(MockWebSocketConstructor).toHaveBeenCalledWith(
        'ws://localhost:3008/ws/v1',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ gatewayUrl: 'ws://localhost:3008' }),
        expect.stringContaining('Connecting')
      );
    });

    it('should connect without Bearer token (anonymous)', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });

      await client.connect();

      expect(client.isClientConnected()).toBe(true);
      expect(MockWebSocketConstructor).toHaveBeenCalledWith(
        'ws://localhost:3008/ws/v1',
        expect.objectContaining({
          headers: {},
        })
      );
    });

    it('should include userId in query param if provided', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        userId: 'brat-chat:test',
        logger: mockLogger,
      });

      await client.connect();

      expect(MockWebSocketConstructor).toHaveBeenCalledWith(
        expect.stringContaining('userId=brat-chat%3Atest'),
        expect.any(Object)
      );
    });

    it('should throw error if already connected', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });

      await client.connect();

      await expect(client.connect()).rejects.toThrow('Already connected');
    });

    it('should disconnect cleanly', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });

      await client.connect();
      await client.disconnect();

      expect(client.isClientConnected()).toBe(false);
      expect(mockWsInstance?.closeCalled).toBe(true);
    });

    it('should handle disconnect when not connected', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });

      // Should not throw
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('Message Sending', () => {
    beforeEach(async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        authToken: 'test-token',
        logger: mockLogger,
      });
      await client.connect();
    });

    it('should send message with correct frame structure', async () => {
      const responsePromise = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        waitForResponse: false,
      });

      await responsePromise;

      expect(mockWsInstance?.sent).toHaveLength(1);
      const frame = JSON.parse(mockWsInstance!.sent[0]);

      expect(frame).toMatchObject({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        metadata: {
          id: expect.any(String),
          timestamp: expect.any(String),
        },
      });
    });

    it('should auto-generate correlationId if not provided', async () => {
      await client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        waitForResponse: false,
      });

      const frame = JSON.parse(mockWsInstance!.sent[0]);
      expect(frame.metadata.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/); // UUID pattern
    });

    it('should use provided correlationId', async () => {
      await client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        metadata: { id: 'custom-id' },
        waitForResponse: false,
      });

      const frame = JSON.parse(mockWsInstance!.sent[0]);
      expect(frame.metadata.id).toBe('custom-id');
    });

    it('should throw error if not connected', async () => {
      await client.disconnect();

      await expect(
        client.sendMessage({
          type: 'chat.message.v1',
          payload: { text: 'Hello' },
        })
      ).rejects.toThrow('Not connected');
    });
  });

  describe('Response Correlation', () => {
    beforeEach(async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        authToken: 'test-token',
        logger: mockLogger,
      });
      await client.connect();
    });

    it('should wait for response and correlate by correlationId', async () => {
      const responsePromise = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        metadata: { id: 'test-correlation-id' },
        waitForResponse: true,
      });

      // Simulate response
      setImmediate(() => {
        mockWsInstance!.simulateMessage({
          v: '2',
          correlationId: 'test-correlation-id',
          type: 'chat.message.v1',
          message: { id: 'msg1', role: 'assistant', text: 'Response' },
          routing: { stage: 'response', slip: [], history: [] },
          ingress: { ingressAt: new Date().toISOString(), source: 'test', connector: 'api' },
          identity: { external: { id: 'test', platform: 'test' } },
          egress: { destination: 'test', connector: 'api' },
        } as InternalEventV2);
      });

      const response = await responsePromise;

      expect(response).toBeDefined();
      expect(response?.correlationId).toBe('test-correlation-id');
      expect(response?.message?.text).toBe('Response');
    });

    it('should handle multiple concurrent requests', async () => {
      const promise1 = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Message 1' },
        metadata: { id: 'id-1' },
        waitForResponse: true,
      });

      const promise2 = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Message 2' },
        metadata: { id: 'id-2' },
        waitForResponse: true,
      });

      // Simulate responses in reverse order
      setImmediate(() => {
        mockWsInstance!.simulateMessage({
          v: '2',
          correlationId: 'id-2',
          type: 'chat.message.v1',
          message: { id: 'msg2', role: 'assistant', text: 'Response 2' },
          routing: { stage: 'response', slip: [], history: [] },
          ingress: { ingressAt: new Date().toISOString(), source: 'test', connector: 'api' },
          identity: { external: { id: 'test', platform: 'test' } },
          egress: { destination: 'test', connector: 'api' },
        } as InternalEventV2);

        mockWsInstance!.simulateMessage({
          v: '2',
          correlationId: 'id-1',
          type: 'chat.message.v1',
          message: { id: 'msg3', role: 'assistant', text: 'Response 1' },
          routing: { stage: 'response', slip: [], history: [] },
          ingress: { ingressAt: new Date().toISOString(), source: 'test', connector: 'api' },
          identity: { external: { id: 'test', platform: 'test' } },
          egress: { destination: 'test', connector: 'api' },
        } as InternalEventV2);
      });

      const [response1, response2] = await Promise.all([promise1, promise2]);

      expect(response1?.correlationId).toBe('id-1');
      expect(response1?.message?.text).toBe('Response 1');
      expect(response2?.correlationId).toBe('id-2');
      expect(response2?.message?.text).toBe('Response 2');
    });

    it('should emit unsolicited messages as events', (done) => {
      client.on('message', (event: InternalEventV2) => {
        expect(event.correlationId).toBe('unsolicited-id');
        expect(event.message?.text).toBe('Unsolicited');
        done();
      });

      // Simulate unsolicited message
      mockWsInstance!.simulateMessage({
        v: '2',
        correlationId: 'unsolicited-id',
        type: 'chat.message.v1',
        message: { id: 'msg4', role: 'assistant', text: 'Unsolicited' },
        routing: { stage: 'response', slip: [], history: [] },
        ingress: { ingressAt: new Date().toISOString(), source: 'test', connector: 'api' },
        identity: { external: { id: 'test', platform: 'test' } },
        egress: { destination: 'test', connector: 'api' },
      } as InternalEventV2);
    });
  });

  describe('Timeout Handling', () => {
    beforeEach(async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        authToken: 'test-token',
        logger: mockLogger,
      });
      await client.connect();
    });

    it('should timeout after specified duration', async () => {
      const responsePromise = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        waitForResponse: true,
        timeoutMs: 100,
      });

      // Don't send response - let it timeout

      await expect(responsePromise).rejects.toThrow('Response timeout after 100ms');
    }, 10000);

    it('should use default timeout of 10000ms', async () => {
      const responsePromise = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        metadata: { id: 'test-id' },
        waitForResponse: true,
        // timeoutMs not specified
      });

      // Respond quickly
      setImmediate(() => {
        mockWsInstance!.simulateMessage({
          v: '2',
          correlationId: 'test-id',
          type: 'chat.message.v1',
          routing: { stage: 'response', slip: [], history: [] },
          ingress: { ingressAt: new Date().toISOString(), source: 'test', connector: 'api' },
          identity: { external: { id: 'test', platform: 'test' } },
          egress: { destination: 'test', connector: 'api' },
        } as InternalEventV2);
      });

      await expect(responsePromise).resolves.toBeDefined();
    });
  });

  describe('Event Injection (event.inject.v2)', () => {
    beforeEach(async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        authToken: 'test-token',
        logger: mockLogger,
      });
      await client.connect();
    });

    it('should send event.inject.v2 frame with full event', async () => {
      await client.sendEvent({
        event: {
          type: 'chat.message.v1',
          message: { text: '!help', role: 'user', id: 'msg-1' },
          ingress: {
            source: 'ingress.discord',
            connector: 'discord',
            ingressAt: new Date().toISOString(),
          },
          identity: {
            external: {
              id: '123456',
              platform: 'discord',
              displayName: 'TestUser',
            },
          },
          egress: {
            destination: 'test',
            type: 'chat',
            connector: 'discord',
          },
        },
        waitForResponse: false,
      });

      expect(mockWsInstance?.sent).toHaveLength(1);
      const frame = JSON.parse(mockWsInstance!.sent[0]);

      expect(frame.type).toBe('event.inject.v2');
      expect(frame.payload.event).toMatchObject({
        type: 'chat.message.v1',
        message: { text: '!help' },
        ingress: { connector: 'discord' },
        identity: { external: { platform: 'discord' } },
      });
    });

    it('should wait for response from event injection', async () => {
      const responsePromise = client.sendEvent({
        event: {
          type: 'chat.message.v1',
          correlationId: 'inject-test',
        },
        waitForResponse: true,
      });

      setImmediate(() => {
        mockWsInstance!.simulateMessage({
          v: '2',
          correlationId: 'inject-test',
          type: 'chat.message.v1',
          routing: { stage: 'response', slip: [], history: [] },
          ingress: { ingressAt: new Date().toISOString(), source: 'test', connector: 'api' },
          identity: { external: { id: 'test', platform: 'test' } },
          egress: { destination: 'test', connector: 'api' },
        } as InternalEventV2);
      });

      const response = await responsePromise;
      expect(response?.correlationId).toBe('inject-test');
    });
  });

  describe('Error Handling', () => {
    it('should handle WebSocket connection error', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });

      // Add error listener to prevent unhandled error
      const errorPromise = new Promise<Error>((resolve) => {
        client.on('error', resolve);
      });

      const connectPromise = client.connect();

      // Simulate connection error immediately (before open)
      process.nextTick(() => {
        const error = new Error('Connection refused');
        mockWsInstance!.simulateError(error);
      });

      // Connection should reject
      await expect(connectPromise).rejects.toThrow('Connection refused');

      // Error event should be emitted
      const emittedError = await errorPromise;
      expect(emittedError.message).toBe('Connection refused');

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle JSON parse error on incoming message', async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });

      await client.connect();

      // Simulate invalid JSON
      const invalidBuffer = Buffer.from('invalid json {');
      mockWsInstance!.emit('message', invalidBuffer);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
        'Failed to parse incoming message'
      );
    });

    it('should emit error event on WebSocket error', (done) => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });

      client.on('error', (err: Error) => {
        expect(err.message).toBe('Test error');
        done();
      });

      client.connect().then(() => {
        const error = new Error('Test error');
        mockWsInstance!.simulateError(error);
      });
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      client = new ApiGatewayClient({
        gatewayUrl: 'ws://localhost:3008',
        logger: mockLogger,
      });
      await client.connect();
    });

    it('should reject pending responses on disconnect', async () => {
      const responsePromise = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Hello' },
        waitForResponse: true,
      });

      // Disconnect before response
      await client.disconnect();

      await expect(responsePromise).rejects.toThrow('Connection closed before response received');
    });

    it('should clean up multiple pending responses', async () => {
      const promise1 = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Message 1' },
        waitForResponse: true,
      });

      const promise2 = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Message 2' },
        waitForResponse: true,
      });

      const promise3 = client.sendMessage({
        type: 'chat.message.v1',
        payload: { text: 'Message 3' },
        waitForResponse: true,
      });

      // Disconnect before any responses
      await client.disconnect();

      await expect(promise1).rejects.toThrow('Connection closed');
      await expect(promise2).rejects.toThrow('Connection closed');
      await expect(promise3).rejects.toThrow('Connection closed');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ count: 3 }),
        'Cleaning up pending responses'
      );
    });

    it('should emit close event on disconnect', (done) => {
      client.on('close', () => {
        done();
      });

      client.disconnect();
    });
  });
});
