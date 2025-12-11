import { buildContext, evaluate } from '../jsonlogic-evaluator';
import type { InternalEventV2 } from '../../../types/events';

describe('JsonLogic extra ops: has_role, has_annotation, has_candidate, text_contains', () => {
  const evt: InternalEventV2 = {
    v: '1', source: 'test', correlationId: 'abc', type: 'chat.message.v1', channel: '#test', userId: 'u1',
    user: { id: 'u1', roles: ['Mod', 'Subscriber'] },
    annotations: [
      { id: 'a1', kind: 'custom', source: 'test', createdAt: '2020-01-01T00:00:00Z', label: 'intent', value: 'greet' },
      { id: 'a2', kind: 'custom', source: 'test', createdAt: '2020-01-01T00:00:01Z', label: 'topic', value: 'games' },
    ] as any,
    candidates: [
      { id: 'c1', kind: 'text', source: 'llm-bot', createdAt: '2020-01-01T00:00:02Z', status: 'proposed', priority: 1, text: 'hi' },
    ] as any,
    message: { id: 'm1', role: 'user', text: 'Hello World', rawPlatformPayload: { text: 'Hello World' } },
  } as any;

  it('has_role works with case-insensitive option', () => {
    const ctx = buildContext(evt);
    expect(evaluate({ has_role: [ { var: 'user.roles' }, 'mod', true ] } as any, ctx)).toBe(true);
    expect(evaluate({ has_role: [ { var: 'user.roles' }, 'Admin' ] } as any, ctx)).toBe(false);
  });

  it('has_annotation detects label/value', () => {
    const ctx = buildContext(evt);
    expect(evaluate({ has_annotation: [ { var: 'annotations' }, 'intent' ] } as any, ctx)).toBe(true);
    expect(evaluate({ has_annotation: [ { var: 'annotations' }, 'intent', 'greet' ] } as any, ctx)).toBe(true);
    expect(evaluate({ has_annotation: [ { var: 'annotations' }, 'intent', 'other' ] } as any, ctx)).toBe(false);
  });

  it('has_candidate matches any or by provider/source', () => {
    const ctx = buildContext(evt);
    expect(evaluate({ has_candidate: [ { var: 'candidates' } ] } as any, ctx)).toBe(true);
    expect(evaluate({ has_candidate: [ { var: 'candidates' }, 'llm-bot' ] } as any, ctx)).toBe(true);
    expect(evaluate({ has_candidate: [ { var: 'candidates' }, 'other' ] } as any, ctx)).toBe(false);
  });

  it('text_contains supports optional case-insensitive flag', () => {
    const ctx = buildContext(evt);
    expect(evaluate({ text_contains: [ { var: 'message.text' }, 'world' ] } as any, ctx)).toBe(false);
    expect(evaluate({ text_contains: [ { var: 'message.text' }, 'world', true ] } as any, ctx)).toBe(true);
  });
});
