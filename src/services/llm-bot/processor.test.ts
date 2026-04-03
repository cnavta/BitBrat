import { processEvent } from './processor';
import { BaseServer } from '../../common/base-server';
import { InternalEventV2 } from '../../types/events';

class TestServer extends BaseServer { constructor() { super({ serviceName: 'test-llm-bot' }); } }

function baseEvt(): InternalEventV2 {
  return {
    v: '2',
    source: 'test',
    correlationId: 'c-1',
    type: 'llm.request.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    routingSlip: [{ id: 'llm-bot', status: 'PENDING', nextTopic: 'internal.finalize.v1' }],
  } as any;
}

describe('llm-bot processor', () => {
  test('SKIP when no prompt annotations', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    const status = await processEvent(server, evt, { callLLM: async () => 'should not be called' });
    expect(status).toBe('SKIP');
    expect(evt.candidates).toBeUndefined();
  });

  test('OK and candidate appended when prompt annotations exist', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Say hi' },
    ] as any;
    const status = await processEvent(server, evt, { callLLM: async () => 'Hi there!' });
    expect(status).toBe('OK');
    expect(Array.isArray(evt.candidates)).toBe(true);
    expect(evt.candidates![0].text).toContain('Hi');
  });

  test('injects disposition context without overriding normal prompt flow', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.identity = { external: { platform: 'twitch', id: 'viewer-1' } } as any;
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Reply kindly' },
    ] as any;

    let capturedInput = '';
    const status = await processEvent(server, evt, {
      fetchDisposition: async () => ({
        band: 'frustrated',
        asOf: '2026-04-03T00:00:00Z',
        window: { startAt: '2026-04-02T23:45:00Z', endAt: '2026-04-03T00:00:00Z', messageCount: 5, windowMs: 900000, maxEvents: 20 },
        indicators: { supportivenessIndex: 0.1, frictionIndex: 0.8, agitationIndex: 0.4, spamIndex: 0.1, safetyConcernIndex: 0.2, confidence: 0.71 },
        flags: ['deescalate', 'avoid-humor'],
        expiresAt: '2099-04-03T00:20:00Z',
      }),
      callLLM: async (_model, input) => {
        capturedInput = input;
        return 'Absolutely — let\'s walk through it calmly.';
      },
    });

    expect(status).toBe('OK');
    expect(evt.annotations?.some((annotation) => annotation.kind === 'disposition')).toBe(true);
    expect(capturedInput).toContain('Active user disposition: frustrated.');
    expect(capturedInput).toContain('Never let disposition override the current message risk, intent, or tone signals.');
  });

});
