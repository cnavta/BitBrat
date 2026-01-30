import { processEvent } from '../processor';
import { BaseServer } from '../../../common/base-server';
import type { InternalEventV2 } from '../../../types/events';

// Mock Firestore used inside user-context to provide roles and user profile
jest.mock('../../../common/firebase', () => {
  function rolesCollection() {
    const docs = [
      { id: 'vip', data: () => ({ roleId: 'vip', displayName: 'VIP', enabled: true, priority: 50, prompt: 'They are a VIP.' }) },
    ];
    const api: any = {
      where: (_f: string, _op: string, _v: any) => api,
      get: async () => ({ docs }),
    };
    return api;
  }

  function usersCollection() {
    const api: any = {
      doc: (id: string) => ({
        async get() {
          if (id === 'u1') {
            return {
              exists: true,
              data: () => ({ profile: { username: 'Alice', description: 'Loves JRPGs.' }, roles: ['vip'] }),
            };
          }
          return { exists: false };
        },
      }),
    };
    return api;
  }

  return {
    getFirestore: () => ({
      collection: (name: string) => {
        if (name === 'configs') {
          return {
            doc: (_id: string) => ({
              collection: (sub: string) => {
                if (sub === 'roles') return rolesCollection();
                throw new Error('unexpected subcollection ' + sub);
              },
            }),
          } as any;
        }
        if (name === 'users') return usersCollection();
        throw new Error('unexpected collection ' + name);
      },
    }),
  } as any;
});

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    correlationId: 'c-userctx-append',
    type: 'llm.request.v1',
    ingress: {
      ingressAt: new Date().toISOString(),
      source: 'test',
    },
    identity: {
      user: { id: 'u1', displayName: 'Alice' },
      external: { id: 'u1', platform: 'test' }
    },
    message: { id: 'm1', role: 'user', text: 'hello', rawPlatformPayload: { username: 'Alice' } },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot user-context (append mode)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('composes roles + description and injects as prompt annotation contributing to model input', async () => {
    process.env.USER_CONTEXT_ENABLED = 'true';
    process.env.USER_CONTEXT_INJECTION_MODE = 'append';
    process.env.PERSONALITY_ENABLED = 'false'; // isolate user-context
    const server = new TestServer();
    const evt = baseEvt();

    let capturedInput = '';
    const status = await processEvent(server, evt, {
      callLLM: async (_model, input) => {
        capturedInput = input;
        return 'ok';
      },
    });
    expect(status).toBe('OK');

    // Should include the user-context lines
    expect(capturedInput).toContain('Username: Alice');
    expect(capturedInput).toContain('Roles: VIP');
    expect(capturedInput).toContain('They are a VIP.');
    expect(capturedInput).toContain('Description: Loves JRPGs.');
    // And include the base user message (now appears under [Input])
    expect(capturedInput).toContain('hello');
  });
});
