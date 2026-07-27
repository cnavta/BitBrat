import { processEvent } from '../processor';
import { Bit } from '../../../common/base-server';
import type { InternalEventV2 } from '../../../types/events';
import type { IDocumentStore } from '../../../common/persistence/interfaces';

// Mock DocumentStore (Sprint 344: PostgreSQL migration)
const mockDocumentStore: IDocumentStore = {
  get: jest.fn(async (collection: string, id: string) => {
    // Return personality data for query
    if (collection === 'personalities') {
      return { name: 'p2', text: 'DBTEXT2', status: 'active', version: 9 };
    }
    return null;
  }) as any,
  set: jest.fn(async () => {}) as any,
  delete: jest.fn(async () => {}) as any,
  query: jest.fn(async (collection: string, options: any) => {
    // Simulate personality lookup query
    if (collection === 'personalities') {
      return [{ name: 'p2', text: 'DBTEXT2', status: 'active', version: 9 }];
    }
    return [];
  }) as any,
  getAll: jest.fn(async () => []) as any,
  watch: jest.fn(() => () => {}) as any,
  batch: jest.fn(async () => {}) as any,
  health: jest.fn(async () => ({ healthy: true })) as any,
};

// Mock Firestore (should not be called when documentStore is provided)
jest.mock('../../../common/firebase', () => ({
  getFirestore: jest.fn(() => {
    throw new Error('getFirestore() should not be called when documentStore is provided');
  }),
}));

class TestServer extends Bit { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-pers-mixed',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot processor with mixed personalities (inline + name)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('composes inline first (earlier createdAt) then name-based text', async () => {
    process.env.PERSONALITY_ENABLED = 'true';
    process.env.LLM_BOT_SYSTEM_PROMPT = 'BASE';
    const server = new TestServer();
    const evt = baseEvt();
    const t0 = new Date(Date.now() - 2000).toISOString();
    const t1 = new Date(Date.now() - 1000).toISOString();
    evt.annotations = [
      { id: 'p-inline', kind: 'personality', source: 'test', createdAt: t0, payload: { text: 'INLINE' } },
      { id: 'p-name', kind: 'personality', source: 'test', createdAt: t1, payload: { name: 'p2' } },
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any;

    let capturedInput = '';
    const status = await processEvent(server, evt, {
      callLLM: async (_model, input) => {
        capturedInput = input;
        return 'ok';
      },
      documentStore: mockDocumentStore,
      fetchByName: async (name: string) => {
        if (name === 'p2') {
          return { name: 'p2', text: 'DBTEXT2', status: 'active', version: 9 };
        }
        return undefined;
      },
    });
    expect(status).toBe('OK');
    const idxInline = capturedInput.indexOf('INLINE');
    const idxDb = capturedInput.indexOf('DBTEXT2');
    expect(idxInline).toBeGreaterThan(-1);
    expect(idxDb).toBeGreaterThan(-1);
    expect(idxInline).toBeLessThan(idxDb); // order preserved
  });
});
