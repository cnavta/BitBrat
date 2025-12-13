import { processEvent } from '../processor';
import { BaseServer } from '../../../common/base-server';
import type { InternalEventV2 } from '../../../types/events';

// Mock Firestore getFirestore used inside processor.ts
jest.mock('../../../common/firebase', () => {
  const buildQuery = (docs: any[]) => ({
    where: (_field: string, _op: string, _value: any) => buildQuery(docs),
    orderBy: (_field: string, _dir: string) => buildQuery(docs),
    limit: (_n: number) => buildQuery(docs),
    get: async () => ({ docs }),
  });
  const fakeDoc = { data: () => ({ name: 'p2', text: 'DBTEXT2', status: 'active', version: 9 }) };
  return {
    getFirestore: () => ({
      collection: (_name: string) => buildQuery([fakeDoc]),
    }),
  } as any;
});

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '1',
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
    });
    expect(status).toBe('OK');
    const idxInline = capturedInput.indexOf('INLINE');
    const idxDb = capturedInput.indexOf('DBTEXT2');
    expect(idxInline).toBeGreaterThan(-1);
    expect(idxDb).toBeGreaterThan(-1);
    expect(idxInline).toBeLessThan(idxDb); // order preserved
  });
});
