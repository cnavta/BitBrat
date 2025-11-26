import { buildContext, evaluate } from '../jsonlogic-evaluator';
import type { InternalEventV1 } from '../../../types/events';

describe('JsonLogicEvaluator', () => {
  const baseEvt: InternalEventV1 = {
    envelope: { v: '1', source: 'test', correlationId: 'abc' },
    type: 'chat.command.v1',
    channel: '#test',
    userId: 'u1',
    payload: { text: '!ping', nested: { value: 42 } },
  };

  it('builds context with now/ts and evaluates truthy logic', () => {
    const ctx = buildContext(baseEvt, '2020-01-01T00:00:00.000Z', 1577836800000);
    const logic = {
      and: [
        { '==': [{ var: 'type' }, 'chat.command.v1'] },
        { '>': [{ var: 'payload.text.length' }, 1] },
      ],
    } as any;
    expect(evaluate(logic, ctx)).toBe(true);
  });

  it('returns false for non-matching logic', () => {
    const ctx = buildContext(baseEvt);
    const logic = { '==': [{ var: 'type' }, 'chat.message.v1'] } as any;
    expect(evaluate(logic, ctx)).toBe(false);
  });

  it('supports nested var access', () => {
    const ctx = buildContext(baseEvt);
    const logic = { '==': [{ var: 'payload.nested.value' }, 42] } as any;
    expect(evaluate(logic, ctx)).toBe(true);
  });

  it('handles malformed logic gracefully', () => {
    const ctx = buildContext(baseEvt);
    expect(evaluate(null as any, ctx)).toBe(false);
    expect(evaluate(123 as any, ctx)).toBe(false);
    // logic that throws inside json-logic should be caught; simulate by passing object with unexpected shape
    expect(evaluate({ unknown: ['x'] } as any, ctx)).toBe(false);
  });
});
