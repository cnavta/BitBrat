import { processEvent } from '../processor';
import { BaseServer } from '../../../common/base-server';
import type { InternalEventV2 } from '../../../types/events';

// Mock Firestore getFirestore used inside processor.ts to resolve personalities by name
jest.mock('../../../common/firebase', () => {
  const buildQuery = (docs: any[]) => ({
    where: (_field: string, _op: string, _value: any) => buildQuery(docs),
    orderBy: (_field: string, _dir: string) => buildQuery(docs),
    limit: (_n: number) => buildQuery(docs),
    get: async () => ({ docs }),
  });
  const fakeDoc = { data: () => ({ name: 'p1', text: 'DBTEXT', status: 'active', version: 7 }) };
  return {
    getFirestore: () => ({
      collection: (_name: string) => buildQuery([fakeDoc]),
    }),
  } as any;
});

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-pers-name',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot processor with name-based personality (Firestore lookup)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('resolves latest active personality by name and composes into system prompt (append mode)', async () => {
    process.env.PERSONALITY_ENABLED = 'true';
    process.env.LLM_BOT_SYSTEM_PROMPT = 'BASE';
    const server = new TestServer();
    const evt = baseEvt();
    // Name-based personality + prompt to trigger model call
    evt.annotations = [
      { id: 'p1', kind: 'personality', source: 'test', createdAt: new Date().toISOString(), payload: { name: 'p1' } },
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
    // Should include a system section and the base system prompt text and the DB-resolved text (mapped into Identity under system)
    expect(capturedInput).toContain('(system)');
    expect(capturedInput).toContain('BASE');
    expect(capturedInput).toContain('DBTEXT');
    // And it should include Task and Input sections containing the prompt and base text
    expect(capturedInput).toContain('## [Task]');
    expect(capturedInput).toContain('Say hi');
    expect(capturedInput).toContain('## [Input]');
    expect(capturedInput).toContain('hello');
  });
});
