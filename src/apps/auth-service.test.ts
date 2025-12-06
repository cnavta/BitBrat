import request from 'supertest';

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
import { createApp } from './auth-service';

describe('generated service', () => {
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

});
