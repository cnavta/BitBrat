// Mocks must be set up before importing the module under test
let subscribeSubject: string | undefined;
let capturedHandler: ((data: Buffer, attrs: Record<string, string>) => Promise<void>) | undefined;

jest.mock('../../services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any) => {
          subscribeSubject = subject;
          capturedHandler = async (data: Buffer, attrs: Record<string, string>) =>
            handler(data, attrs, { ack: async () => {}, nack: async () => {} });
          return async () => {};
        },
      };
    },
  };
});

import { createApp } from '../command-processor-service';
import { INTERNAL_COMMAND_V1 } from '../../types/events';
import { logger } from '../../common/logging';

describe('command-processor subscriber', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Preserve env and set values to allow subscription during tests
    prevEnv.NODE_ENV = process.env.NODE_ENV;
    prevEnv.JEST_WORKER_ID = process.env.JEST_WORKER_ID;
    prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    process.env.NODE_ENV = 'development';
    process.env.JEST_WORKER_ID = '' as any; // falsy for "!!process.env.JEST_WORKER_ID"
    delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;

    subscribeSubject = undefined;
    capturedHandler = undefined;
    process.env.BUS_PREFIX = 'dev.';
  });

  afterEach(() => {
    // Restore env
    if (prevEnv.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv.NODE_ENV;
    if (prevEnv.JEST_WORKER_ID === undefined) delete process.env.JEST_WORKER_ID; else process.env.JEST_WORKER_ID = prevEnv.JEST_WORKER_ID as any;
    if (prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE === undefined) delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; else process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    jest.restoreAllMocks();
  });

  it('logs receipt for V2 input (correlationId propagation)', async () => {
    const spy = jest.spyOn(logger, 'info').mockImplementation((() => {}) as any);
    createApp();
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeSubject).toBe(`dev.${INTERNAL_COMMAND_V1}`);

    const v2 = {
      v: '1',
      source: 'ingress.test',
      correlationId: 'c-1',
      type: 'chat.command.v1',
      message: { id: 'm-0', role: 'user', text: '!ping' },
    } as any;

    await capturedHandler!(Buffer.from(JSON.stringify(v2), 'utf8'), {});

    // Ensure a receipt log was emitted with correlationId
    const found = spy.mock.calls.find((c) => c[0] === 'command_processor.event.received');
    expect(found).toBeTruthy();
    if (found) {
      const meta: any = (found as any)[1];
      expect(meta && meta.correlationId).toBe('c-1');
    }
  });

  it('accepts V2 input and logs receipt', async () => {
    const spy = jest.spyOn(logger, 'info').mockImplementation((() => {}) as any);
    createApp();
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeSubject).toBe(`dev.${INTERNAL_COMMAND_V1}`);

    const v2 = {
      v: '1',
      source: 'ingress.test',
      correlationId: 'c-2',
      type: 'chat.command.v1',
      message: { id: 'm-1', role: 'user', text: '!ping' },
    } as any;

    await capturedHandler!(Buffer.from(JSON.stringify(v2), 'utf8'), {});

    const found = spy.mock.calls.find((c) => c[0] === 'command_processor.event.received');
    expect(found).toBeTruthy();
    if (found) {
      const meta: any = (found as any)[1];
      expect(meta && meta.correlationId).toBe('c-2');
    }
  });
});
