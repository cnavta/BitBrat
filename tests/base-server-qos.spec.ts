import { BaseServer } from '../src/common/base-server';
import { logger } from '../src/common/logging';

// Mock the message-bus to capture the subscribed handler and invoke it manually
const subscribeMock = jest.fn(async (_subject: string, handler: any, _opts?: any) => {
  ;(global as any).__capturedHandler = handler;
  return async () => {};
});
const createMessageSubscriberMock = jest.fn(() => ({ subscribe: subscribeMock }));

jest.mock('../src/services/message-bus', () => ({
  createMessageSubscriber: () => createMessageSubscriberMock(),
  createMessagePublisher: () => ({ publishJson: jest.fn() }),
}));

describe('BaseServer QOS Enforcement', () => {
  class TestServer extends BaseServer {
    constructor() { super({ serviceName: 'test-qos' }); }
    async wire() {
      await this.onMessage('test.topic', async (data) => {
        if (data.delay) {
          await new Promise(resolve => setTimeout(resolve, data.delay));
        }
      });
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete (global as any).__capturedHandler;
    // BaseServer uses its internal this.logger, so we need to spy on that instance or the Logger class
    jest.spyOn(require('../src/common/logging').Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(require('../src/common/logging').Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(require('../src/common/logging').Logger.prototype, 'error').mockImplementation();
    // Use real timers for the timeout test since we're using real setTimeout in BaseServer
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Tracer logging: logs full event on receive if qos.tracer is true', async () => {
    const srv = new TestServer();
    await srv['wire']();
    const handler = (global as any).__capturedHandler;
    
    const event = { correlationId: 't-1', qos: { tracer: true } };
    const payload = Buffer.from(JSON.stringify(event), 'utf8');
    const ctx = { ack: jest.fn(), nack: jest.fn() };
    
    await handler(payload, {}, ctx);
    
    expect(require('../src/common/logging').Logger.prototype.debug).toHaveBeenCalledWith('base_server.message.tracer.receive', expect.objectContaining({
      event: expect.objectContaining({ correlationId: 't-1' })
    }));
  });

  test('Processing timeout: warns and adds error entry if maxResponseMs is exceeded', async () => {
    const srv = new TestServer();
    await srv['wire']();
    const handler = (global as any).__capturedHandler;
    
    // Set a short timeout and a longer delay in the handler
    const event: any = { correlationId: 'timeout-1', qos: { maxResponseMs: 100 }, delay: 500 };
    const payload = Buffer.from(JSON.stringify(event), 'utf8');
    const ctx = { ack: jest.fn(), nack: jest.fn() };
    
    await handler(payload, {}, ctx);
    
    expect(require('../src/common/logging').Logger.prototype.warn).toHaveBeenCalledWith('base_server.message.qos.timeout', expect.objectContaining({
      correlationId: 'timeout-1',
      maxResponseMs: 100
    }));

    // Check if error was added to event (we can't easily check 'event' since it's local to handler, 
    // but the logger call above confirms it reached that branch)
    expect(require('../src/common/logging').Logger.prototype.error).toHaveBeenCalledWith('base_server.message.handler_error', expect.objectContaining({
        error: expect.stringContaining('BB_QOS_TIMEOUT')
    }));
  });

  test('Processing timeout: does not warn if processing finishes in time', async () => {
    const srv = new TestServer();
    await srv['wire']();
    const handler = (global as any).__capturedHandler;
    
    const event = { correlationId: 'ok-1', qos: { maxResponseMs: 500 }, delay: 100 };
    const payload = Buffer.from(JSON.stringify(event), 'utf8');
    const ctx = { ack: jest.fn(), nack: jest.fn() };
    
    await handler(payload, {}, ctx);
    
    expect(require('../src/common/logging').Logger.prototype.warn).not.toHaveBeenCalled();
    expect(require('../src/common/logging').Logger.prototype.error).not.toHaveBeenCalled();
  });
});
