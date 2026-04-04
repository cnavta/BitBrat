import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2 } from '../../../types/events';
import { INTERNAL_EGRESS_V1, INTERNAL_ROUTER_DLQ_V1 } from '../../../types/events';
import { buildContext, evaluate } from '../../router/jsonlogic-evaluator';

describe('Sprint 225: Empty routingSlip handling', () => {
  const baseEvt: InternalEventV2 = {
    v: '2',
    correlationId: 'c-empty-slip',
    type: 'chat.command.v1',
    ingress: { ingressAt: '2026-01-29T22:00:00Z', source: 'test' },
    identity: { external: { id: 'u1', platform: 'test' } },
    egress: { destination: 'internal.egress.v1' },
    routing: { stage: 'initial', slip: [], history: [] },
    message: { id: 'm1', role: 'user', text: '!lurk', rawPlatformPayload: {} },
  } as any;

  it('routes to egress instead of DLQ when matching a rule with empty routing slip', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-lurk', enabled: true, priority: 1,
        logic: JSON.stringify({ 'text_contains': [{ var: 'message.text' }, '!lurk'] }),
        routing: { stage: 'response', slip: [] }, // EMPTY SLIP
        enrichments: {},
      } as any,
    ];

    const engine = new RouterEngine();
    const { slip, decision } = await engine.route(baseEvt, rules);

    expect(decision.matched).toBe(true);
    expect(decision.selectedTopic).toBe(INTERNAL_EGRESS_V1);
    
    // According to "follow the convention of having a completed slip"
    // The resulting slip should be considered complete by slip_complete operator
    const ctx = buildContext({ ...baseEvt, routing: { stage: 'response', slip, history: [] } } as any);
    expect(evaluate({ slip_complete: [ { var: 'routing.slip' } ] } as any, ctx)).toBe(true);
  });

  it('still defaults to DLQ when no rules match', async () => {
    const rules: RuleDoc[] = [];
    const engine = new RouterEngine();
    const { decision } = await engine.route(baseEvt, rules);

    expect(decision.matched).toBe(false);
    expect(decision.selectedTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
  });
});
