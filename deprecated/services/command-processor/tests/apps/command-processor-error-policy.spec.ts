let subscribeSubject: string | undefined;
let capturedHandler: ((data: Buffer, attrs: Record<string, string>, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => Promise<void>) | undefined;

// Default publisher mock; individual tests may re-mock to throw
jest.mock('../../src/services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any) => {
          subscribeSubject = subject;
          capturedHandler = handler;
          return async () => {};
        },
      };
    },
    createMessagePublisher: (topic: string) => {
      return {
        publishJson: async (_evt: any, _attrs: Record<string, string>) => {
          return null;
        },
        flush: async () => {},
      };
    },
  };
});

import { createApp } from '../../src/apps/command-processor-service';
import { INTERNAL_COMMAND_V1 } from '../../src/types/events';

describe('command-processor error handling policy (ack/nack)', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    prevEnv.BUS_PREFIX = process.env.BUS_PREFIX;
    prevEnv.NODE_ENV = process.env.NODE_ENV;
    prevEnv.JEST_WORKER_ID = process.env.JEST_WORKER_ID;
    prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    process.env.BUS_PREFIX = 'dev.';
    process.env.NODE_ENV = 'development';
    // @ts-ignore
    process.env.JEST_WORKER_ID = '';
    delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    subscribeSubject = undefined;
    capturedHandler = undefined;
    createApp();
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeSubject).toBe(`dev.${INTERNAL_COMMAND_V1}`);
  });

  afterEach(() => {
    if (prevEnv.BUS_PREFIX === undefined) delete process.env.BUS_PREFIX; else process.env.BUS_PREFIX = prevEnv.BUS_PREFIX;
    if (prevEnv.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv.NODE_ENV;
    if (prevEnv.JEST_WORKER_ID === undefined) delete (process.env as any).JEST_WORKER_ID; else process.env.JEST_WORKER_ID = prevEnv.JEST_WORKER_ID as any;
    if (prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE === undefined) delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; else process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('acks on JSON parse errors (poison message)', async () => {
    const ack = jest.fn(async () => {});
    const nack = jest.fn(async () => {});
    await capturedHandler!(Buffer.from('{not-json'), {}, { ack, nack });
    expect(ack).toHaveBeenCalled();
    expect(nack).not.toHaveBeenCalled();
  });


});
