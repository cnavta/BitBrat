import { buildContext, evaluate } from '../jsonlogic-evaluator';
import type { InternalEventV2, RoutingStep } from '../../../types/events';

describe('JsonLogic op: slip_complete', () => {
  const baseEvt: InternalEventV2 = {
    v: '2', source: 'test', correlationId: 'abc', type: 'chat.command.v1', channel: '#test', userId: 'u1',
    routingSlip: [],
    message: { id: 'm1', role: 'user', text: '!ping', rawPlatformPayload: {} },
  } as any;

  it('returns true when all steps are OK', () => {
    const slip: RoutingStep[] = [
      { id: 'router', v: '2', status: 'OK', attempt: 1, nextTopic: 'internal.llmbot.v1' },
      { id: 'llm-bot', v: '2', status: 'OK', attempt: 1, nextTopic: 'internal.egress.v1' },
    ];
    const ctx = buildContext({ ...baseEvt, routingSlip: slip } as any);
    expect(evaluate({ slip_complete: [ { var: 'routingSlip' } ] } as any, ctx)).toBe(true);
  });

  it('returns true when last OK step is terminal (no nextTopic)', () => {
    const slip: RoutingStep[] = [
      { id: 'router', v: '2', status: 'OK', attempt: 1, nextTopic: 'internal.llmbot.v1' },
      { id: 'egress', v: '2', status: 'OK', attempt: 1 },
    ];
    const ctx = buildContext({ ...baseEvt, routingSlip: slip } as any);
    expect(evaluate({ slip_complete: [ { var: 'routingSlip' } ] } as any, ctx)).toBe(true);
  });

  it('returns false when any step is PENDING or ERROR or slip missing', () => {
    const slipPending: RoutingStep[] = [
      { id: 'router', v: '2', status: 'OK', attempt: 1, nextTopic: 'internal.llmbot.v1' },
      { id: 'llm-bot', v: '2', status: 'PENDING', attempt: 0, nextTopic: 'internal.egress.v1' },
    ];
    const ctx1 = buildContext({ ...baseEvt, routingSlip: slipPending } as any);
    expect(evaluate({ slip_complete: [ { var: 'routingSlip' } ] } as any, ctx1)).toBe(false);

    const slipError: RoutingStep[] = [
      { id: 'router', v: '2', status: 'ERROR', attempt: 1, nextTopic: 'internal.llmbot.v1' },
    ];
    const ctx2 = buildContext({ ...baseEvt, routingSlip: slipError } as any);
    expect(evaluate({ slip_complete: [ { var: 'routingSlip' } ] } as any, ctx2)).toBe(false);

    const ctx3 = buildContext({ ...baseEvt, routingSlip: [] } as any);
    expect(evaluate({ slip_complete: [ { var: 'routingSlip' } ] } as any, ctx3)).toBe(false);
  });
});
