import { buildContext, evaluate } from '../jsonlogic-evaluator';
import type { InternalEventV2 } from '../../../types/events';

describe('JsonLogic op: ci_eq', () => {
  const baseEvt: InternalEventV2 = {
    v: '2', source: 'test', correlationId: 'abc',
    type: 'chat.command.v1', channel: '#test', userId: 'u1',
    message: { id: 'm1', role: 'user', text: '!Ping', rawPlatformPayload: { text: '!Ping' } },
  } as any;

  it('matches equal strings ignoring case', () => {
    const ctx = buildContext(baseEvt);
    const logic = { ci_eq: [ { var: 'message.text' }, '!ping' ] } as any;
    expect(evaluate(logic, ctx)).toBe(true);
  });

  it('returns false for different strings', () => {
    const ctx = buildContext(baseEvt);
    const logic = { ci_eq: [ { var: 'message.text' }, '!pong' ] } as any;
    expect(evaluate(logic, ctx)).toBe(false);
  });

  it('coerces non-strings safely', () => {
    const evt = { ...baseEvt, message: { ...(baseEvt as any).message, text: 123 } } as any;
    const ctx = buildContext(evt);
    expect(evaluate({ ci_eq: [ { var: 'message.text' }, '123' ] } as any, ctx)).toBe(true);
    expect(evaluate({ ci_eq: [ null, undefined ] } as any, ctx)).toBe(true); // '' === ''
  });
});
