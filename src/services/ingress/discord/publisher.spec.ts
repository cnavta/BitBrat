import { DiscordIngressPublisher } from './publisher';
import type { InternalEventV2 } from '../../../types/events';

// Mock the message-bus factory to inject a controllable fake publisher and capture the subject
const publishCalls: Array<{ data: any; attrs: Record<string, string> }> = [];
let factorySubject: string | undefined;
let publishImpl: (data: any, attrs?: Record<string, string>) => Promise<void>;

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

describe('DiscordIngressPublisher', () => {
  beforeEach(() => {
    publishCalls.length = 0;
    factorySubject = undefined;
    publishImpl = async (data: any, attrs?: Record<string, string>) => {
      publishCalls.push({ data, attrs: attrs || {} });
    };
  });

  it('publishes to ${BUS_PREFIX}internal.ingress.v1 with attributes (V2)', async () => {
    process.env.BUS_PREFIX = 'dev.';
    const pub = new DiscordIngressPublisher({ busPrefix: 'dev.' });

    const evt: InternalEventV2 = {
      v: '2',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'ingress.discord',
      },
      identity: {
        external: { id: 'u1', platform: 'discord' }
      },
      correlationId: 'c1',
      type: 'chat.message.v1',
      message: { id: 'm1', role: 'user', text: 'hi' },
      egress: { destination: '' }
    } as any;

    await pub.publish(evt);
    expect(factorySubject).toBe('dev.internal.ingress.v1');
    expect(publishCalls).toHaveLength(1);
    const call = publishCalls[0];
    expect(call.data).toEqual(evt);
    expect(call.attrs.type).toBe('chat.message.v1');
    expect(call.attrs.source).toBe('ingress.discord');
    expect(call.attrs.correlationId).toBe('c1');
  });

  // Sprint 24: Tests for snapshot publishing callback
  describe('onPublished callback (Sprint 24)', () => {
    it('calls onPublished callback after successful publish', async () => {
      const onPublishedMock = jest.fn().mockResolvedValue(undefined);
      const pub = new DiscordIngressPublisher({
        busPrefix: '',
        onPublished: onPublishedMock
      });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.discord' },
        identity: { external: { id: 'u1', platform: 'discord' } },
        correlationId: 'c-snapshot-1',
        type: 'chat.message.v1',
        message: { id: 'm1', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'discord' as any }
      } as any;

      await pub.publish(evt);

      expect(onPublishedMock).toHaveBeenCalledTimes(1);
      expect(onPublishedMock).toHaveBeenCalledWith(evt);
    });

    it('does NOT call onPublished if publish fails', async () => {
      const onPublishedMock = jest.fn();
      publishImpl = async () => {
        throw new Error('Publish failed');
      };

      const pub = new DiscordIngressPublisher({
        busPrefix: '',
        onPublished: onPublishedMock
      });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.discord' },
        identity: { external: { id: 'u1', platform: 'discord' } },
        correlationId: 'c-snapshot-2',
        type: 'chat.message.v1',
        message: { id: 'm2', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'discord' as any }
      } as any;

      await expect(pub.publish(evt)).rejects.toThrow('Publish failed');
      expect(onPublishedMock).not.toHaveBeenCalled();
    });

    it('succeeds even if onPublished callback fails (fail-open)', async () => {
      const onPublishedMock = jest.fn().mockRejectedValue(new Error('Snapshot failed'));
      const pub = new DiscordIngressPublisher({
        busPrefix: '',
        onPublished: onPublishedMock
      });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.discord' },
        identity: { external: { id: 'u1', platform: 'discord' } },
        correlationId: 'c-snapshot-3',
        type: 'chat.message.v1',
        message: { id: 'm3', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'discord' as any }
      } as any;

      // Should not throw despite callback failure
      await pub.publish(evt);

      expect(onPublishedMock).toHaveBeenCalledTimes(1);
      expect(publishCalls).toHaveLength(1); // Publish succeeded
    });

    it('does not call onPublished if callback not provided', async () => {
      const pub = new DiscordIngressPublisher({ busPrefix: '' });

      const evt: InternalEventV2 = {
        v: '2',
        ingress: { ingressAt: new Date().toISOString(), source: 'ingress.discord' },
        identity: { external: { id: 'u1', platform: 'discord' } },
        correlationId: 'c-snapshot-4',
        type: 'chat.message.v1',
        message: { id: 'm4', role: 'user', text: 'test' },
        egress: { destination: '', connector: 'discord' as any }
      } as any;

      // Should succeed without errors
      await pub.publish(evt);
      expect(publishCalls).toHaveLength(1);
    });
  });
});
