// Mocks must be declared before importing the module under test
let subscribeSubject: string | undefined;
let handlerFn: ((data: Buffer, attrs: Record<string, string>) => Promise<void>) | undefined;
let publishedSubject: string | undefined;
let publishCalls: Array<{ data: any; attrs: Record<string, string> }> = [];

jest.mock('../../services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any) => {
          subscribeSubject = subject;
          handlerFn = async (data: Buffer, attrs: Record<string, string>) => handler(data, attrs, { ack: async () => {}, nack: async () => {} });
          return async () => {};
        },
      };
    },
    createMessagePublisher: (subject: string) => {
      publishedSubject = subject;
      return {
        publishJson: async (data: any, attrs?: Record<string, string>) => {
          publishCalls.push({ data, attrs: attrs || {} });
          return 'mid-x';
        },
        flush: async () => {},
      };
    },
  };
});

jest.mock('../../common/firebase', () => {
  return {
    getFirestore: () => ({
      collection: () => ({
        get: async () => ({ docs: [] }),
        onSnapshot: (cb: any) => {
          // initial empty snapshot
          cb({ docs: [] });
          return () => {};
        },
      }),
    }),
  };
});

import { createApp } from '../event-router-service';
import type { InternalEventV1 } from '../../types/events';
import { INTERNAL_ROUTER_DLQ_V1 } from '../../types/events';
import { logger } from '../../common/logging';

// Test doubles and captors

describe('event-router ingress integration', () => {
  beforeEach(() => {
    subscribeSubject = undefined;
    publishedSubject = undefined;
    handlerFn = undefined;
    publishCalls = [];
    process.env.BUS_PREFIX = 'dev.';
  });

  it('routes event and publishes to first step topic (default DLQ with no rules)', async () => {
    const spy = jest.spyOn(logger, 'debug').mockImplementation((() => {}) as any);
    createApp();
    expect(subscribeSubject).toBe('dev.internal.ingress.v1');

    const evt: InternalEventV1 = {
      envelope: { v: '1', source: 'ingress.test', correlationId: 'c-evt', routingSlip: [] },
      type: 'chat.message.v1',
      payload: { text: 'hi' },
      channel: '#ch',
    } as any;

    // simulate delivery
    await handlerFn!(Buffer.from(JSON.stringify(evt), 'utf8'), {});

    // Assert publish subject and attributes
    expect(publishedSubject).toBe(`dev.${INTERNAL_ROUTER_DLQ_V1}`);
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0].data.envelope.routingSlip[0].nextTopic).toBe(INTERNAL_ROUTER_DLQ_V1);

    // Assert decision logging occurred
    const found = spy.mock.calls.find((c) => c[0] === 'router.decision');
    expect(found).toBeTruthy();
    if (found) {
      const meta = found[1];
      expect(meta.matched).toBe(false);
      expect(meta.selectedTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
    }
    spy.mockRestore();
  });
});
