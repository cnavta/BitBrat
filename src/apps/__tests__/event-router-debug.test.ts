// Capture bus interactions and handler to simulate message delivery
let handlerFn: ((data: Buffer, attrs: Record<string, string>) => Promise<void>) | undefined;

jest.mock('../../services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (_subject: string, handler: any) => {
          handlerFn = async (data: Buffer, attrs: Record<string, string>) => handler(data, attrs, { ack: async () => {}, nack: async () => {} });
          return async () => {};
        },
      };
    },
    createMessagePublisher: (_subject: string) => {
      return {
        publishJson: async (_data: any, _attrs?: Record<string, string>) => {
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
          cb({ docs: [] });
          return () => {};
        },
      }),
    }),
  };
});

import request from 'supertest';
import { createApp } from '../event-router-service';
import type { InternalEventV2 } from '../../types/events';
import { counters } from '../../common/counters';

describe('/_debug/counters endpoint (event-router)', () => {
  beforeEach(() => {
    handlerFn = undefined;
    counters.resetAll();
    process.env.BUS_PREFIX = 'dev.';
  });

  it('returns counters as JSON', async () => {
    const app = createApp();
    const res = await request(app).get('/_debug/counters').expect(200);
    expect(res.body && typeof res.body).toBe('object');
    expect(res.body.counters).toMatchObject({
      'router.events.total': 0,
      'router.rules.matched': 0,
      'router.rules.defaulted': 0,
    });
  });

  it('counters update after processing a message (defaulted path)', async () => {
    const app = createApp();
    // yield to allow subscription mock to be set up
    await new Promise((r) => setTimeout(r, 0));

    const before = await request(app).get('/_debug/counters').expect(200);
    expect(before.body.counters['router.events.total']).toBe(0);

    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c-1',
      type: 'chat.message.v1',
      ingress: { ingressAt: '2026-01-29T22:00:00Z', source: 'test', channel: '#ch' },
      identity: { external: { id: 'u1', platform: 'test' } },
      egress: { destination: 'test' },
      payload: { text: 'hello' },
    } as any;
    await handlerFn!(Buffer.from(JSON.stringify(evt), 'utf8'), {});

    const after = await request(app).get('/_debug/counters').expect(200);
    expect(after.body.counters['router.events.total']).toBe(1);
    expect(after.body.counters['router.rules.defaulted']).toBe(1);
    expect(after.body.counters['router.rules.matched']).toBe(0);
  });
});
