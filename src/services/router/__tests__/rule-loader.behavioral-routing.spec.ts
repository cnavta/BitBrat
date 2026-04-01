import { buildContext, evaluate } from '../jsonlogic-evaluator';
import { RuleLoader } from '../rule-loader';
import type { InternalEventV2 } from '../../../types/events';

function makeDoc(id: string, data: any) {
  return { id, data: () => data } as any;
}

function makeSnap(docs: any[]) {
  return { docs } as any;
}

function baseEvent(): InternalEventV2 {
  return {
    v: '2',
    correlationId: 'router-behavioral',
    type: 'chat.message.v1',
    ingress: { ingressAt: '2026-04-01T00:00:00Z', source: 'test', channel: '#test' },
    identity: { external: { id: 'u1', platform: 'test' } },
    egress: { destination: 'internal.egress.v1' },
    message: { id: 'm1', role: 'user', text: 'hello' },
  } as any;
}

describe('RuleLoader behavioral routing fixtures', () => {
  it('loads and evaluates representative annotation-aware routes for spam, high-risk, and meta cases', () => {
    const loader = new RuleLoader('configs/routingRules/rules');
    (loader as any).refreshFromSnapshot(makeSnap([
      makeDoc('spam-finalize', {
        enabled: true,
        priority: 1,
        description: 'Finalize spam without sending to llm-bot',
        logic: {
          has_annotation: [{ var: 'annotations' }, 'intent', 'spam']
        },
        routingSlip: [{ id: 'router', nextTopic: 'internal.persistence.finalize.v1' }],
      }),
      makeDoc('high-risk-finalize', {
        enabled: true,
        priority: 2,
        description: 'Finalize high-risk traffic without normal generation',
        logic: {
          has_annotation: [{ var: 'annotations' }, 'risk', 'high']
        },
        routingSlip: [{ id: 'router', nextTopic: 'internal.persistence.finalize.v1' }],
      }),
      makeDoc('meta-to-llm-bot', {
        enabled: true,
        priority: 3,
        description: 'Prefer llm-bot for safe meta/system questions',
        logic: {
          has_annotation: [{ var: 'annotations' }, 'intent', 'meta']
        },
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
      }),
    ]));

    const rules = loader.getRules();
    expect(rules.map((rule) => rule.id)).toEqual(['spam-finalize', 'high-risk-finalize', 'meta-to-llm-bot']);

    const spamCtx = buildContext({
      ...baseEvent(),
      annotations: [{ id: 'a1', kind: 'intent', source: 'test', createdAt: '2026-04-01T00:00:00Z', label: 'spam', value: 'spam' }],
    } as any);
    expect(evaluate(JSON.parse(rules[0].logic), spamCtx)).toBe(true);

    const highRiskCtx = buildContext({
      ...baseEvent(),
      annotations: [{ id: 'a1', kind: 'risk', source: 'test', createdAt: '2026-04-01T00:00:00Z', label: 'high', payload: { level: 'high', type: 'privacy' } }],
    } as any);
    expect(evaluate(JSON.parse(rules[1].logic), highRiskCtx)).toBe(true);

    const metaCtx = buildContext({
      ...baseEvent(),
      annotations: [{ id: 'a1', kind: 'intent', source: 'test', createdAt: '2026-04-01T00:00:00Z', label: 'meta', value: 'meta' }],
    } as any);
    expect(evaluate(JSON.parse(rules[2].logic), metaCtx)).toBe(true);
  });
});