import request from 'supertest';
import { INTERNAL_AUTH_V1 } from '../types/events';

// Mock message bus with singleton subscriber so tests can access the mock
const subscribeMock = jest.fn(async () => async () => {});
const subscriberSingleton = { subscribe: subscribeMock };
jest.mock('../services/message-bus', () => ({
  createMessagePublisher: jest.fn(() => ({
    publishJson: jest.fn(async () => 'msg-id'),
    flush: jest.fn(async () => {}),
  })),
  createMessageSubscriber: jest.fn(() => subscriberSingleton),
}));

// Mock Firestore to avoid real initialization in tests
const mockFirestore = {
  collection: () => ({
    doc: () => ({ get: async () => ({ exists: false }) }),
    get: async () => ({ docs: [] }),
    onSnapshot: (cb: any) => { cb({ docs: [] }); return () => {}; },
  }),
};

jest.mock('../common/firebase', () => {
  return {
    getFirestore: () => mockFirestore,
  };
});

// We need to mock getResource to return our mock firestore
import { createApp, AuthServer } from './auth-service';

// Patch AuthServer to mock getResource (using 'any' to bypass protected access)
const originalGetResource = (AuthServer.prototype as any).getResource;
(AuthServer.prototype as any).getResource = function(name: string) {
  if (name === 'firestore') return mockFirestore;
  if (name === 'publisher') return {
    create: jest.fn().mockReturnValue({
      publishJson: jest.fn().mockResolvedValue('msg-id'),
    }),
  };
  return originalGetResource?.call(this, name);
};

describe('auth-service', () => {
  const prev = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
  const prevDriver = process.env.PERSISTENCE_DRIVER;
  let app: any;

  beforeAll(() => {
    process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = '1';
    // Use Firestore for tests to avoid needing DATABASE_URL
    process.env.PERSISTENCE_DRIVER = 'firestore';
    // Create app AFTER setting env vars
    app = createApp();
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE; else process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = prev;
    if (prevDriver === undefined) delete process.env.PERSISTENCE_DRIVER; else process.env.PERSISTENCE_DRIVER = prevDriver;
    // Restore original getResource
    (AuthServer.prototype as any).getResource = originalGetResource;
  });
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

  it('subscribes to internal.auth.v1 with BUS_PREFIX', async () => {
    const origEnv = process.env.BUS_PREFIX;
    const origDisable = process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    const origDriver = process.env.PERSISTENCE_DRIVER;
    process.env.BUS_PREFIX = 'test.';
    process.env.PERSISTENCE_DRIVER = 'firestore'; // Use Firestore for test
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
