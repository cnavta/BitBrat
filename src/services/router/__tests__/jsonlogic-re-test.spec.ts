import { buildContext, evaluate } from '../jsonlogic-evaluator';
import type { InternalEventV2 } from '../../../types/events';

describe('JsonLogic op: re_test', () => {
  const baseEvt: InternalEventV2 = {
    v: '1', source: 'test', correlationId: 'abc',
    type: 'chat.command.v1', channel: '#test', userId: 'u1',
    message: { id: 'm1', role: 'user', text: 'FoObAr', rawPlatformPayload: { text: 'FoObAr' } },
  } as any;

  it('matches simple pattern', () => {
    const ctx = buildContext(baseEvt);
    const logic = { re_test: [ { var: 'message.text' }, 'oOb' ] } as any;
    expect(evaluate(logic, ctx)).toBe(true);
  });

  it('supports [pattern, flags] form', () => {
    const ctx = buildContext(baseEvt);
    const logic = { re_test: [ { var: 'message.text' }, ['^f', 'i'] ] } as any;
    expect(evaluate(logic, ctx)).toBe(true);
  });

  it('returns false on invalid regex', () => {
    const ctx = buildContext(baseEvt);
    const logic = { re_test: [ { var: 'message.text' }, '(*' ] } as any;
    expect(evaluate(logic, ctx)).toBe(false);
  });
});
