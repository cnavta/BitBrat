import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2, AnnotationV1 } from '../../../types/events';

describe('RouterEngine – annotations propagation', () => {
  const baseEvt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-ann-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text: '!go' },
    annotations: [
      { id: 'a1', kind: 'custom', source: 'pre', createdAt: '2025-01-01T00:00:00Z', label: 'pre' },
    ] as AnnotationV1[],
  } as any;

  it('appends rule annotations to evtOut and preserves input immutability', () => {
    const ruleAnns: AnnotationV1[] = [
      { id: 'r1', kind: 'intent', source: 'rule', createdAt: '2025-01-02T00:00:00Z', label: 'cmd' },
      { id: 'r2', kind: 'topic', source: 'rule', createdAt: '2025-01-03T00:00:00Z', label: 'routing' },
    ];
    const rules: RuleDoc[] = [
      {
        id: 'r-yes', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.command.v1' ] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
        annotations: ruleAnns,
      },
    ];

    const before = baseEvt.annotations && [...baseEvt.annotations];
    const engine = new RouterEngine();
    const { evtOut } = engine.route(baseEvt, rules);

    // input not mutated
    expect(baseEvt.annotations).toEqual(before);
    // output contains appended annotations in order: existing then rule-sourced
    expect(evtOut.annotations).toBeDefined();
    expect(evtOut.annotations!.map(a => a.id)).toEqual(['a1', 'r1', 'r2']);
  });

  it('no-op when rule has no annotations', () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-yes', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.command.v1' ] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
      },
    ];

    const engine = new RouterEngine();
    const { evtOut } = engine.route(baseEvt, rules);
    expect(evtOut.annotations?.map(a => a.id)).toEqual(['a1']);
  });
});
