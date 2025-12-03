import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2 } from '../../../types/events';
import { INTERNAL_ROUTER_DLQ_V1 } from '../../../types/events';

describe('RouterEngine', () => {
  const baseEvt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-1',
    routingSlip: [],
    type: 'chat.command.v1',
    channel: '#ch',
    userId: 'u1',
    message: { id: 'm1', role: 'user', text: '!ping', rawPlatformPayload: { text: '!ping' } },
  } as any;

  it('selects the first matching rule (priority/short-circuit)', () => {
    const rules: RuleDoc[] = [
      {
        id: 'r0', enabled: true, priority: 5, description: 'non-match',
        logic: { '==': [{ var: 'type' }, 'chat.message.v1'] } as any,
        routingSlip: [{ id: 'router', nextTopic: 'internal.never.v1' }],
      },
      {
        id: 'r1', enabled: true, priority: 10, description: 'match',
        logic: { '==': [{ var: 'type' }, 'chat.command.v1'] } as any,
        routingSlip: [{ id: 'router', v: '1', nextTopic: 'internal.llmbot.v1' }],
      },
      {
        id: 'r2', enabled: true, priority: 20, description: 'would also match but should be skipped',
        logic: { '==': [{ var: 'type' }, 'chat.command.v1'] } as any,
        routingSlip: [{ id: 'router', nextTopic: 'internal.other.v1' }],
      },
    ];

    const engine = new RouterEngine();
    const { slip, decision } = engine.route(baseEvt, rules);

    expect(slip).toHaveLength(1);
    expect(slip[0].id).toBe('router');
    expect(slip[0].status).toBe('PENDING');
    expect(slip[0].attempt).toBe(0);
    expect(slip[0].v).toBe('1');
    expect(slip[0].nextTopic).toBe('internal.llmbot.v1');

    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('r1');
    expect(decision.priority).toBe(10);
    expect(decision.selectedTopic).toBe('internal.llmbot.v1');
  });

  it('falls back to default DLQ when no rule matches', () => {
    const rules: RuleDoc[] = [
      {
        id: 'r0', enabled: true, priority: 1,
        logic: { '==': [{ var: 'type' }, 'chat.message.v1'] } as any,
        routingSlip: [{ id: 'router', nextTopic: 'internal.never.v1' }],
      },
    ];
    const engine = new RouterEngine();
    const { slip, decision } = engine.route(baseEvt, rules);
    expect(slip).toHaveLength(1);
    expect(slip[0].status).toBe('PENDING');
    expect(slip[0].attempt).toBe(0);
    expect(slip[0].v).toBe('1');
    expect(slip[0].nextTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
    expect(decision.matched).toBe(false);
    expect(decision.selectedTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
  });
});
