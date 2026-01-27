import { INTERNAL_COMMAND_V1 } from '../../../src/types/events';
import { createApp } from '../../../src/apps/command-processor-service';
import { logger } from '../../../src/common/logging';
import { processEvent } from '../../../src/services/command-processor/processor';

let subscribeSubject: string | undefined;
let capturedRawHandler: any;
const published: Array<{ topic: string; evt: any; attrs: Record<string, string> }> = [];

jest.mock('../../../src/services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any) => {
          subscribeSubject = subject;
          capturedRawHandler = handler; // capture raw handler to supply our own ctx
          return async () => {};
        },
      };
    },
    createMessagePublisher: (topic: string) => {
      return {
        publishJson: async (evt: any, attrs: Record<string, string>) => {
          published.push({ topic, evt, attrs });
          return null;
        },
        flush: async () => {},
      };
    },
  };
});

// Mock the processor to return a pre-baked outcome stored on global
jest.mock('../../../src/services/command-processor/processor', () => {
  return {
    processEvent: jest.fn(async () => (global as any).__PROCESS_RESULT),
  };
});

describe('command-processor routing advancement', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    prevEnv.BUS_PREFIX = process.env.BUS_PREFIX;
    prevEnv.NODE_ENV = process.env.NODE_ENV;
    prevEnv.JEST_WORKER_ID = process.env.JEST_WORKER_ID;
    prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    process.env.BUS_PREFIX = 'dev.';
    // Allow subscription inside Jest by simulating non-test env and clearing guards
    process.env.NODE_ENV = 'development';
    // @ts-ignore
    process.env.JEST_WORKER_ID = '';
    delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    subscribeSubject = undefined;
    capturedRawHandler = undefined;
    published.length = 0;
    jest.spyOn(logger, 'info').mockImplementation((() => {}) as any);
    // Initialize app and subscription
    createApp();
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeSubject).toBe(`dev.${INTERNAL_COMMAND_V1}`);
  });

  afterEach(() => {
    if (prevEnv.BUS_PREFIX === undefined) delete process.env.BUS_PREFIX; else process.env.BUS_PREFIX = prevEnv.BUS_PREFIX;
    if (prevEnv.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv.NODE_ENV;
    if (prevEnv.JEST_WORKER_ID === undefined) delete (process.env as any).JEST_WORKER_ID; else process.env.JEST_WORKER_ID = prevEnv.JEST_WORKER_ID as any;
    if (prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE === undefined) delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; else process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = prevEnv.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    jest.restoreAllMocks();
  });

  function makeBaseV2(overrides: Partial<any> = {}) {
    return {
      v: '1',
      source: 'ingress.test',
      correlationId: 'c-adv-1',
      type: 'chat.command.v1',
      message: { id: 'm-1', role: 'user', text: '!ping' },
      ...overrides,
    } as any;
  }

  it('publishes to next pending step topic when present', async () => {
    const slip = [
      { id: 'command-processor', status: 'PENDING', nextTopic: 'internal.next.v1' },
      { id: 'egress', status: 'PENDING', nextTopic: 'internal.egress.v1' },
    ];
    const v2 = makeBaseV2({ routingSlip: slip });
    (global as any).__PROCESS_RESULT = { action: 'produced', stepStatus: 'OK', event: v2 };

    const ack = jest.fn(async () => {});
    const nack = jest.fn(async () => {});

    await capturedRawHandler!(Buffer.from(JSON.stringify(v2), 'utf8'), {}, { ack, nack });

    expect(ack).toHaveBeenCalled();
    expect(nack).not.toHaveBeenCalled();
    expect(published.length).toBe(1);
    // After processor marks current step OK, the first pending becomes index 1 (egress)
    expect(published[0].topic).toBe('dev.internal.egress.v1');
    // Ensure processor was invoked and routing step updated
    expect((processEvent as unknown as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    const publishedEvt = published[0].evt as any;
    expect(Array.isArray(publishedEvt.routingSlip)).toBe(true);
    expect(publishedEvt.routingSlip[0].status).toBe('OK');
    expect(typeof publishedEvt.routingSlip[0].endedAt).toBe('string');
    // Attributes should include type, correlationId, source
    expect(published[0].attrs.type).toBe(v2.type);
    expect(published[0].attrs.correlationId).toBe(v2.correlationId);
    expect(published[0].attrs.source).toBe('command-processor');
  });

  it('publishes to egress metadata when no pending steps remain', async () => {
    const slip = [
      { id: 'command-processor', status: 'OK' },
      { id: 'egress', status: 'OK' },
    ];
    const v2 = makeBaseV2({ routingSlip: slip, egress: { destination: 'internal.egress.v1.dev1' } });
    (global as any).__PROCESS_RESULT = { action: 'produced', stepStatus: 'OK', event: v2 };

    const ack = jest.fn(async () => {});
    const nack = jest.fn(async () => {});

    await capturedRawHandler!(Buffer.from(JSON.stringify(v2), 'utf8'), {}, { ack, nack });

    expect(ack).toHaveBeenCalled();
    expect(nack).not.toHaveBeenCalled();
    expect(published.length).toBe(1);
    expect(published[0].topic).toBe('dev.internal.egress.v1.dev1');
  });

  it('logs completion when no pending steps and no egressDestination', async () => {
    const slip = [
      { id: 'command-processor', status: 'OK' },
    ];
    const v2 = makeBaseV2({ routingSlip: slip });
    (global as any).__PROCESS_RESULT = { action: 'produced', stepStatus: 'OK', event: v2 };

    const ack = jest.fn(async () => {});
    const nack = jest.fn(async () => {});
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation((() => {}) as any);

    await capturedRawHandler!(Buffer.from(JSON.stringify(v2), 'utf8'), {}, { ack, nack });

    expect(ack).toHaveBeenCalled();
    expect(nack).not.toHaveBeenCalled();
    expect(published.length).toBe(0);
    const found = infoSpy.mock.calls.find((c) => c[0] === 'command_processor.advance.complete');
    expect(found).toBeTruthy();
  });
});
