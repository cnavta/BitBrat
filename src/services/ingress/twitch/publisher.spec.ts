import { TwitchIngressPublisher } from './publisher';
import type { InternalEventV2 } from '../../../types/events';

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

  it('publishes to ${BUS_PREFIX}internal.ingress.v1 with attributes (V2)', async () => {
    process.env.BUS_PREFIX = 'dev.';
    const pub = new TwitchIngressPublisher({ busPrefix: 'dev.', jitterMs: 0 });

    const evt: InternalEventV2 = {
      v: '2',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twitch',
        channel: '#ch',
      },
      identity: {
        external: { id: 'u1', platform: 'twitch' }
      },
      correlationId: 'c1',
      traceId: 't1',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: 'hi', rawPlatformPayload: { foo: 'bar' } },
      egress: { destination: '' }
    } as any;

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

  it('retries on transient gRPC codes up to configured maxRetries', async () => {
    let attempts = 0;
    publishImpl = async (data: any, attrs?: Record<string, string>) => {
      publishCalls.push({ data, attrs: attrs || {} });
      attempts++;
      if (attempts < 3) {
        const err: any = new Error('UNAVAILABLE');
        err.code = 14; // gRPC UNAVAILABLE
        throw err;
      }
      return 'mid-3';
    };

    const pub = new TwitchIngressPublisher({ busPrefix: '', maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 });
    const evt: InternalEventV2 = {
      v: '2',
      ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      correlationId: 'c2',
      type: 'chat.message.v1',
      message: { id: 'm2', role: 'user', text: 'hello' },
      egress: { destination: '' }
    } as any;

    const res = await pub.publish(evt);
    expect(res).toBe('mid-3');
    expect(publishCalls.length).toBe(3);
  });

  it('does not retry on local publish timeout and propagates after first failure', async () => {
    publishImpl = async (data: any, attrs?: Record<string, string>) => {
      publishCalls.push({ data, attrs: attrs || {} });
      const err: any = new Error('timeout after 2000ms');
      err.code = 4; // DEADLINE_EXCEEDED
      err.reason = 'publish_timeout';
      throw err;
    };

    const pub = new TwitchIngressPublisher({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 });
    const evt: InternalEventV2 = {
      v: '2',
      ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twitch' },
      identity: { external: { id: 'u1', platform: 'twitch' } },
      correlationId: 'c3',
      type: 'chat.message.v1',
      message: { id: 'm3', role: 'user', text: 'yo' },
      egress: { destination: '' }
    } as any;

    await expect(pub.publish(evt)).rejects.toThrow(/timeout/i);
    // should not retry due to publish_timeout
    expect(publishCalls.length).toBe(1);
  });
});
