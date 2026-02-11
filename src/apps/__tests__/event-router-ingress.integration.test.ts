// Mocks must be declared before importing the module under test
let subscribeSubjects: string[] = [];
let handlerFns: Map<string, (data: Buffer, attrs: Record<string, string>) => Promise<void>> = new Map();
let publishedSubject: string | undefined;
let publishCalls: Array<{ data: any; attrs: Record<string, string> }> = [];

jest.mock('../../services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any) => {
          subscribeSubjects.push(subject);
          handlerFns.set(subject, async (data: Buffer, attrs: Record<string, string>) => handler(data, attrs, { ack: async () => {}, nack: async () => {} }));
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
import type { InternalEventV2 } from '../../types/events';
import { INTERNAL_ROUTER_DLQ_V1, INTERNAL_INGRESS_V1, INTERNAL_ENRICHED_V1 } from '../../types/events';
import { logger } from '../../common/logging';

// Test doubles and captors

describe('event-router ingress integration', () => {
  beforeEach(() => {
    subscribeSubjects = [];
    publishedSubject = undefined;
    handlerFns.clear();
    publishCalls = [];
    process.env.BUS_PREFIX = 'dev.';
  });

  it('routes event and publishes to first step topic (default DLQ with no rules)', async () => {
    const spy = jest.spyOn(logger, 'debug').mockImplementation((() => {}) as any);
    createApp();
    // Allow async setup() inside BaseServer to progress to subscription
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribeSubjects).toContain(`dev.${INTERNAL_INGRESS_V1}`);
    expect(subscribeSubjects).toContain(`dev.${INTERNAL_ENRICHED_V1}`);

    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c-evt',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress.test',
        channel: '#ch',
      },
      identity: {
        external: {
          id: 'u1',
          platform: 'test',
        }
      },
      egress: { destination: 'test' },
      payload: { text: 'hi' },
    } as any;

    // simulate delivery
    const handler = handlerFns.get(`dev.${INTERNAL_INGRESS_V1}`);
    await handler!(Buffer.from(JSON.stringify(evt), 'utf8'), {});

    // Assert publish subject and attributes
    expect(publishedSubject).toBe(`dev.${INTERNAL_ROUTER_DLQ_V1}`);
    expect(publishCalls).toHaveLength(1);
    // Router now publishes V2 events; routingSlip is at top-level
    expect(publishCalls[0].data.routingSlip[0].nextTopic).toBe(INTERNAL_ROUTER_DLQ_V1);

    // Assert decision logging occurred
    const found = spy.mock.calls.find((c) => c[0] === 'router.decision');
    expect(found).toBeTruthy();
    if (found) {
      const meta: any = (found as any)[1];
      expect(meta && meta.matched).toBe(false);
      expect(meta && meta.selectedTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
    }
    spy.mockRestore();
  });
});
