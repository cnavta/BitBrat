import { RouterEngine, IStateStore } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2, CandidateV1 } from '../../../types/events';
import { INTERNAL_ROUTER_DLQ_V1 } from '../../../types/events';

class MockStateStore implements IStateStore {
  state: Record<string, string> = {};
  async getLastCandidateId(userId: string, ruleId: string): Promise<string | undefined> {
    return this.state[`${userId}:${ruleId}`];
  }
  async updateLastCandidateId(userId: string, ruleId: string, candidateId: string): Promise<void> {
    this.state[`${userId}:${ruleId}`] = candidateId;
  }
}

describe('RouterEngine', () => {
  const baseEvt: InternalEventV2 = {
    v: '2',
    correlationId: 'c-1',
    type: 'chat.command.v1',
    ingress: {
      ingressAt: '2026-01-29T22:00:00Z',
      source: 'test',
      channel: '#ch',
    },
    identity: {
      external: {
        id: 'u1',
        platform: 'test',
      }
    },
    message: { id: 'm1', role: 'user', text: '!ping', rawPlatformPayload: { text: '!ping' } },
  } as any;

  it('selects the first matching rule (priority/short-circuit)', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r0', enabled: true, priority: 5, description: 'non-match',
        logic: JSON.stringify({ '==': [{ var: 'type' }, 'chat.message.v1'] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.never.v1' }],
        enrichments: {},
      },
      {
        id: 'r1', enabled: true, priority: 10, description: 'match',
        logic: JSON.stringify({ '==': [{ var: 'type' }, 'chat.command.v1'] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
        enrichments: {},
      },
      {
        id: 'r2', enabled: true, priority: 20, description: 'would also match but should be skipped',
        logic: JSON.stringify({ '==': [{ var: 'type' }, 'chat.command.v1'] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.other.v1' }],
        enrichments: {},
      },
    ];

    const engine = new RouterEngine();
    const { slip, decision } = await engine.route(baseEvt, rules);

    expect(slip).toHaveLength(1);
    expect(slip[0].id).toBe('router');
    expect(slip[0].status).toBe('PENDING');
    expect(slip[0].attempt).toBe(0);
    expect(slip[0].v).toBe('2');
    expect(slip[0].nextTopic).toBe('internal.llmbot.v1');

    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('r1');
    expect(decision.priority).toBe(10);
    expect(decision.selectedTopic).toBe('internal.llmbot.v1');
  });

  it('falls back to default DLQ when no rule matches', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r0', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [{ var: 'type' }, 'chat.message.v1'] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.never.v1' }],
        enrichments: {},
      },
    ];
    const engine = new RouterEngine();
    const { slip, decision } = await engine.route(baseEvt, rules);
    expect(slip).toHaveLength(1);
    expect(slip[0].status).toBe('PENDING');
    expect(slip[0].attempt).toBe(0);
    expect(slip[0].v).toBe('2');
    expect(slip[0].nextTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
    expect(decision.matched).toBe(false);
    expect(decision.selectedTopic).toBe(INTERNAL_ROUTER_DLQ_V1);
  });

  it('applies message and candidates enrichments', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r1', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [{ var: 'type' }, 'chat.command.v1'] }),
        routingSlip: [{ id: 'router', nextTopic: 't1' }],
        enrichments: {
          message: 'enriched message',
          candidates: [
            { id: 'c1', kind: 'text', source: 'test', createdAt: '2026-01-01', status: 'proposed', priority: 1 }
          ]
        }
      },
    ];
    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules);
    expect(evtOut.message?.text).toBe('enriched message');
    expect(evtOut.candidates).toHaveLength(1);
    expect(evtOut.candidates![0].id).toBe('c1');
  });

  it('handles randomCandidate selection and avoids last used', async () => {
    const candidates: CandidateV1[] = [
      { id: 'c1', kind: 'text', source: 'test', createdAt: '2026-01-01', status: 'proposed', priority: 1 },
      { id: 'c2', kind: 'text', source: 'test', createdAt: '2026-01-01', status: 'proposed', priority: 1 },
    ];
    const rules: RuleDoc[] = [
      {
        id: 'r1', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [{ var: 'type' }, 'chat.command.v1'] }),
        routingSlip: [{ id: 'router', nextTopic: 't1' }],
        enrichments: {
          randomCandidate: true,
          candidates
        }
      },
    ];
    const stateStore = new MockStateStore();
    const engine = new RouterEngine(undefined, stateStore);

    // 1. First selection
    const res1 = await engine.route(baseEvt, rules);
    const selected1 = res1.evtOut.candidates![0].id;
    expect(['c1', 'c2']).toContain(selected1);
    expect(stateStore.state['u1:r1']).toBe(selected1);

    // 2. Second selection - should avoid selected1
    const res2 = await engine.route(baseEvt, rules);
    const selected2 = res2.evtOut.candidates![0].id;
    expect(selected2).not.toBe(selected1);
    expect(['c1', 'c2']).toContain(selected2);
    expect(stateStore.state['u1:r1']).toBe(selected2);

    // 3. Third selection - should avoid selected2 (back to selected1 since only 2 candidates)
    const res3 = await engine.route(baseEvt, rules);
    const selected3 = res3.evtOut.candidates![0].id;
    expect(selected3).toBe(selected1);
  });
});
