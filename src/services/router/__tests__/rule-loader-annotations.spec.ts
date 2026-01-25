import { RuleLoader } from '../rule-loader';

describe('RuleLoader – annotations passthrough and validation', () => {
  it('includes valid annotations and filters malformed with warnings', () => {
    const loader = new RuleLoader('configs/routingRules/rules');
    const snap = {
      docs: [
        {
          id: 'r-1',
          data: () => ({
            enabled: true,
            priority: 1,
            logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.command.v1' ] }),
            routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
            annotations: [
              { id: 'a1', kind: 'intent', source: 'rule', createdAt: '2025-01-01T00:00:00Z', label: 'ok' },
              { /* malformed */ id: 'missing-fields' },
            ],
          }),
        },
      ],
    } as any;

    (loader as any).refreshFromSnapshot(snap);
    const rules = loader.getRules();
    expect(rules).toHaveLength(1);
    const r = rules[0];
    expect(r.enrichments.annotations).toBeDefined();
    expect(r.enrichments.annotations!.map(a => a.id)).toEqual(['a1']);
  });
});
