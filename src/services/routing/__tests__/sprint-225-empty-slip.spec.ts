import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import { InternalEventV2, INTERNAL_ROUTER_DLQ_V1, INTERNAL_EGRESS_V1 } from '../../../types/events';

describe('Sprint 225: Empty routingSlip handling', () => {
  const baseEvt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-empty-slip',
    type: 'chat.message.v1',
    message: { id: 'm1', role: 'user', text: 'hello' },
    egress: { destination: 'twitch' },
  } as any;

  it('routes to DLQ when NO rules match (baseline behavior)', async () => {
    const rules: RuleDoc[] = [];
    const engine = new RouterEngine();
    const { slip, decision } = await engine.route(baseEvt, rules);

    expect(decision.matched).toBe(false);
    expect(slip).toHaveLength(1);
    expect(slip[0].nextTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
  });

  it('routes to egress if a rule matches but its routingSlip is empty', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-match-empty',
        enabled: true,
        priority: 1,
        logic: JSON.stringify(true),
        routingSlip: [], // Empty array
        enrichments: {},
      } as any,
    ];

    const engine = new RouterEngine();
    const { slip, decision } = await engine.route(baseEvt, rules);

    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('r-match-empty');
    expect(slip).toHaveLength(1);
    expect(slip[0].nextTopic).toBe(INTERNAL_EGRESS_V1);
    expect(decision.selectedTopic).toBe(INTERNAL_EGRESS_V1);
  });
});
