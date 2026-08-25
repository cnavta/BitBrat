import { TwilioIngressPublisher } from './publisher';
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

describe('TwilioIngressPublisher', () => {
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
    const pub = new TwilioIngressPublisher({ busPrefix: 'dev.', jitterMs: 0 });

    const evt: InternalEventV2 = {
      v: '2',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.twilio',
      },
      identity: {
        external: { id: 'u1', platform: 'twilio' }
      },
      correlationId: 'c1',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: 'hi' },
      egress: { destination: '' }
    } as any;

    const res = await pub.publish(evt);
    expect(res).toBe('mid-1');
    expect(factorySubject).toBe('dev.internal.ingress.v1');
    expect(publishCalls).toHaveLength(1);
    const call = publishCalls[0];
    expect(call.data).toEqual(evt);
    expect(call.attrs.type).toBe('chat.message.v1');
    expect(call.attrs.source).toBe('ingress.twilio');
    expect(call.attrs.correlationId).toBe('c1');
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

    const pub = new TwilioIngressPublisher({ busPrefix: '', maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 });
    const evt: InternalEventV2 = {
      v: '2',
      ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twilio' },
      identity: { external: { id: 'u1', platform: 'twilio' } },
      correlationId: 'c2',
      type: 'chat.message.v1',
      message: { id: 'm2', role: 'user', text: 'hello' },
      egress: { destination: '' }
    } as any;

    const res = await pub.publish(evt);
    expect(res).toBe('mid-3');
    expect(publishCalls.length).toBe(3);
  });

  // Sprint 24: Tests for snapshot publishing callback
  describe('onPublished callback (Sprint 24)', () => {
    it('calls onPublished callback after successful publish', async () => {
      const onPublishedMock = jest.fn().mockResolvedValue(undefined);
      const pub = new TwilioIngressPublisher({
        busPrefix: '',
        jitterMs: 0,
        onPublished: onPublishedMock
      });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twilio' },
        identity: { external: { id: 'u1', platform: 'twilio' } },
        correlationId: 'c-snapshot-1',
        type: 'chat.message.v1',
        message: { id: 'm1', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'twilio' as any }
      } as any;

      const res = await pub.publish(evt);

      expect(res).toBe('mid-1');
      expect(onPublishedMock).toHaveBeenCalledTimes(1);
      expect(onPublishedMock).toHaveBeenCalledWith(evt);
    });

    it('does NOT call onPublished if publish fails', async () => {
      const onPublishedMock = jest.fn();
      publishImpl = async () => {
        throw new Error('Publish failed');
      };

      const pub = new TwilioIngressPublisher({
        busPrefix: '',
        maxRetries: 1,
        jitterMs: 0,
        onPublished: onPublishedMock
      });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twilio' },
        identity: { external: { id: 'u1', platform: 'twilio' } },
        correlationId: 'c-snapshot-2',
        type: 'chat.message.v1',
        message: { id: 'm2', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'twilio' as any }
      } as any;

      await expect(pub.publish(evt)).rejects.toThrow('Publish failed');
      expect(onPublishedMock).not.toHaveBeenCalled();
    });

    it('succeeds even if onPublished callback fails (fail-open)', async () => {
      const onPublishedMock = jest.fn().mockRejectedValue(new Error('Snapshot failed'));
      const pub = new TwilioIngressPublisher({
        busPrefix: '',
        jitterMs: 0,
        onPublished: onPublishedMock
      });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twilio' },
        identity: { external: { id: 'u1', platform: 'twilio' } },
        correlationId: 'c-snapshot-3',
        type: 'chat.message.v1',
        message: { id: 'm3', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'twilio' as any }
      } as any;

      // Should not throw despite callback failure
      const res = await pub.publish(evt);

      expect(res).toBe('mid-1');
      expect(onPublishedMock).toHaveBeenCalledTimes(1);
      expect(publishCalls).toHaveLength(1); // Publish succeeded
    });

    it('does not call onPublished if callback not provided', async () => {
      const pub = new TwilioIngressPublisher({ busPrefix: '', jitterMs: 0 });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.twilio' },
        identity: { external: { id: 'u1', platform: 'twilio' } },
        correlationId: 'c-snapshot-4',
        type: 'chat.message.v1',
        message: { id: 'm4', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'twilio' as any }
      } as any;

      // Should succeed without errors
      const res = await pub.publish(evt);
      expect(res).toBe('mid-1');
      expect(publishCalls).toHaveLength(1);
    });
  });
});
