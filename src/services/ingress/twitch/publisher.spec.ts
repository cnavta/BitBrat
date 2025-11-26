import { TwitchIngressPublisher } from './publisher';
import type { InternalEventV1 } from '../../../types/events';

// Mock the message-bus factory to inject a controllable fake publisher and capture the subject
const publishCalls: Array<{ data: any; attrs: Record<string, string> }> = [];
let factorySubject: string | undefined;
let publishImpl: (data: any, attrs?: Record<string, string>) => Promise<string | null>;

jest.mock('../../message-bus', () => {
  return {
    createMessagePublisher: (subject: string) => {
      factorySubject = subject;
      return {
        publishJson: (data: any, attrs?: Record<string, string>) => publishImpl(data, attrs),
        flush: async () => {},
      };
    },
  };
});

describe('TwitchIngressPublisher', () => {
  beforeEach(() => {
    publishCalls.length = 0;
    factorySubject = undefined;
    publishImpl = async (data: any, attrs?: Record<string, string>) => {
      publishCalls.push({ data, attrs: attrs || {} });
      return 'mid-1';
    };
  });

  it('publishes to ${BUS_PREFIX}internal.ingress.v1 with attributes', async () => {
    process.env.BUS_PREFIX = 'dev.';
    const pub = new TwitchIngressPublisher({ busPrefix: 'dev.', jitterMs: 0 });

    const evt: InternalEventV1 = {
      envelope: { v: '1', source: 'ingress.twitch', correlationId: 'c1', traceId: 't1', routingSlip: [] },
      type: 'chat.message.v1',
      payload: { foo: 'bar' },
      channel: '#ch',
    };

    const res = await pub.publish(evt);
    expect(res).toBe('mid-1');
    expect(factorySubject).toBe('dev.internal.ingress.v1');
    expect(publishCalls).toHaveLength(1);
    const call = publishCalls[0];
    expect(call.data).toEqual(evt);
    expect(call.attrs.type).toBe('chat.message.v1');
    expect(call.attrs.source).toBe('ingress.twitch');
    expect(call.attrs.correlationId).toBe('c1');
    expect(call.attrs.traceId).toBe('t1');
  });

  it('retries on failure up to configured maxRetries', async () => {
    let attempts = 0;
    publishImpl = async (data: any, attrs?: Record<string, string>) => {
      publishCalls.push({ data, attrs: attrs || {} });
      attempts++;
      if (attempts < 3) {
        throw new Error('transient');
      }
      return 'mid-3';
    };

    const pub = new TwitchIngressPublisher({ busPrefix: '', maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 });
    const evt: InternalEventV1 = {
      envelope: { v: '1', source: 'ingress.twitch', correlationId: 'c2', routingSlip: [] },
      type: 'chat.message.v1',
      payload: {},
    } as any;

    const res = await pub.publish(evt);
    expect(res).toBe('mid-3');
    expect(publishCalls.length).toBe(3);
  });

  it('propagates error after exhausting retries', async () => {
    publishImpl = async (data: any, attrs?: Record<string, string>) => {
      publishCalls.push({ data, attrs: attrs || {} });
      throw new Error('always fail');
    };

    const pub = new TwitchIngressPublisher({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 });
    const evt: InternalEventV1 = {
      envelope: { v: '1', source: 'ingress.twitch', correlationId: 'c3', routingSlip: [] },
      type: 'chat.message.v1',
      payload: {},
    } as any;

    await expect(pub.publish(evt)).rejects.toThrow('always fail');
    expect(publishCalls.length).toBe(3);
  });
});
