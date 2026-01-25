import { RouterEngine, IJsonLogicEvaluator } from '../src/services/routing/router-engine';
import type { RuleDoc } from '../src/services/router/rule-loader';
import type { InternalEventV2, AnnotationV1, RoutingStep } from '../src/types/events';

describe('E2E (mocked evaluator) — RouterEngine annotations propagation', () => {
  const baseEvt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-e2e-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text: '!hello' },
    annotations: [
      { id: 'pre', kind: 'custom', source: 'pre', createdAt: '2025-01-01T00:00:00Z' },
    ] as AnnotationV1[],
  } as any;

  // Mock evaluator that always matches the first rule we pass in
  const mockEval: IJsonLogicEvaluator = {
    buildContext: (evt: InternalEventV2) => ({ evt } as any),
    evaluate: (_logic: unknown) => true,
  };

  it('appends RuleDoc.annotations and selects routing slip on match', async () => {
    const ruleAnns: AnnotationV1[] = [
      { id: 'r-ann-1', kind: 'intent', source: 'rule', createdAt: '2025-01-02T00:00:00Z' },
      { id: 'r-ann-2', kind: 'topic', source: 'rule', createdAt: '2025-01-03T00:00:00Z' },
    ];
    const rules: RuleDoc[] = [
      {
        id: 'r-match', enabled: true, priority: 1,
        logic: JSON.stringify({ always: true }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
        enrichments: {
          annotations: ruleAnns,
        },
      } as any,
    ];

    const engine = new RouterEngine(mockEval);
    const before = baseEvt.annotations && [...baseEvt.annotations];
    const { slip, decision, evtOut } = await engine.route(baseEvt, rules);

    // Slip normalized and topic selected
    expect(Array.isArray(slip)).toBe(true);
    expect(slip).toHaveLength(1);
    const step = slip[0] as RoutingStep;
    expect(step.status).toBe('PENDING');
    expect(step.attempt).toBe(0);
    expect(step.v).toBe('1');
    expect(step.nextTopic).toBe('internal.llmbot.v1');
    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('r-match');

    // Input immutability
    expect(baseEvt.annotations).toEqual(before);

    // Output annotations appended in order
    expect(evtOut.annotations?.map((a) => a.id)).toEqual(['pre', 'r-ann-1', 'r-ann-2']);
  });
});
