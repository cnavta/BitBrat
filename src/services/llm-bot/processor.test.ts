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

  test('adds behavioral guidance to the assembled prompt and candidate metadata', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'Help the user' },
      { id: 'a2', kind: 'intent', source: 'test', createdAt: new Date().toISOString(), value: 'critique' },
      { id: 'a3', kind: 'tone', source: 'test', createdAt: new Date().toISOString(), payload: { valence: -0.8, arousal: 0.9 } },
      { id: 'a4', kind: 'risk', source: 'test', createdAt: new Date().toISOString(), label: 'low', payload: { level: 'low', type: 'none' } },
    ] as any;

    let capturedPrompt = '';
    const status = await processEvent(server, evt, {
      callLLM: async (_model, input) => {
        capturedPrompt = input;
        return 'Understood.';
      }
    });

    expect(status).toBe('OK');
    expect(capturedPrompt).toContain('Detected user intent: critique.');
    expect(capturedPrompt).toContain('Respond calmly and non-defensively.');
    expect(capturedPrompt).toContain('Address the request constructively and without defensiveness.');
    expect(evt.candidates?.[0].metadata).toMatchObject({
      behaviorProfile: {
        intent: 'critique',
        responseMode: 'deescalate',
        risk: { level: 'low', type: 'none' },
      }
    });
  });

  test('returns a safe refusal without calling the model for medium-risk self-harm', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'answer carefully' },
      { id: 'a2', kind: 'intent', source: 'test', createdAt: new Date().toISOString(), value: 'question' },
      { id: 'a3', kind: 'risk', source: 'test', createdAt: new Date().toISOString(), label: 'med', payload: { level: 'med', type: 'self_harm' } },
    ] as any;

    const callLLM = jest.fn(async () => 'should not be used');
    const status = await processEvent(server, evt, { callLLM });

    expect(status).toBe('OK');
    expect(callLLM).not.toHaveBeenCalled();
    expect(evt.candidates?.[0].reason).toBe('behavior:safe-refusal');
    expect(evt.candidates?.[0].text).toContain('I can’t help with harming yourself');
    expect(evt.annotations?.some((annotation: any) => annotation.kind === 'safety-decision')).toBe(true);
  });

  test('skips high-risk events before model generation', async () => {
    const server = new TestServer();
    const evt = baseEvt();
    evt.annotations = [
      { id: 'a1', kind: 'prompt', source: 'test', createdAt: new Date().toISOString(), value: 'respond if possible' },
      { id: 'a2', kind: 'intent', source: 'test', createdAt: new Date().toISOString(), value: 'joke' },
      { id: 'a3', kind: 'risk', source: 'test', createdAt: new Date().toISOString(), label: 'high', payload: { level: 'high', type: 'illegal' } },
    ] as any;

    const callLLM = jest.fn(async () => 'should not be used');
    const status = await processEvent(server, evt, { callLLM });

    expect(status).toBe('SKIP');
    expect(callLLM).not.toHaveBeenCalled();
    expect(evt.candidates).toBeUndefined();
    expect(evt.annotations?.some((annotation: any) => annotation.kind === 'safety-decision' && annotation.label === 'escalate')).toBe(true);
  });

});
