import request from 'supertest';
import { INTERNAL_AUTH_V1 } from '../types/events';

// Mock message bus
jest.mock('../services/message-bus', () => {
  const subscribe = jest.fn(async (_subject: string, _handler: any) => {
    return async () => {};
  });
  const singleton = { subscribe };
  return {
    __esModule: true,
    createMessageSubscriber: () => singleton,
  };
});

// Mock Firestore to avoid real initialization in tests
jest.mock('../common/firebase', () => {
  return {
    getFirestore: () => ({
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false }) }),
        get: async () => ({ docs: [] }),
        onSnapshot: (cb: any) => { cb({ docs: [] }); return () => {}; },
      }),
    }),
  };
});
import { createApp, AuthServer } from './auth-service';

describe('auth-service', () => {
  const prev = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
  beforeAll(() => {
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = '1';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; else process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = prev;
  });

  const app = createApp();
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  it('subscribes to internal.auth.v1 with BUS_PREFIX', async () => {
    const origEnv = process.env.BUS_PREFIX;
    const origDisable = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    process.env.BUS_PREFIX = 'test.';
    delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; // Enable subscribe for this test

    const mb = require('../services/message-bus');
    const subFn = mb.createMessageSubscriber().subscribe as jest.Mock;
    subFn.mockClear();

    new AuthServer();

    // setupApp() is async; wait a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(subFn).toHaveBeenCalled();
    const [subject, , opts] = subFn.mock.calls[0];
    expect(subject).toBe(`test.${INTERNAL_AUTH_V1}`);
    expect(opts).toMatchObject({ queue: 'auth', ack: 'explicit' });

    process.env.BUS_PREFIX = origEnv;
    if (origDisable === undefined) delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; else process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = origDisable;
  });
});
