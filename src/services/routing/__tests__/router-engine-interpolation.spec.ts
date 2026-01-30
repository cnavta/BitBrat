import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2, AnnotationV1, CandidateV1 } from '../../../types/events';

describe('RouterEngine – interpolation', () => {
  const baseEvt: InternalEventV2 = {
    v: '2',
    correlationId: 'c-interp-1',
    type: 'chat.message.v1',
    ingress: {
      ingressAt: '2026-01-29T22:00:00Z',
      source: 'test',
      channel: '#general',
    },
    identity: {
      user: { displayName: 'Alice' },
      external: { id: 'u1', platform: 'test' }
    },
    message: { id: 'm1', role: 'user', text: 'Hello' },
  } as any;

  it('interpolates variables in message, annotations and candidates', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-interp', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.message.v1' ] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
        metadata: {
          version: '2.0',
          channel: 'wrong-channel' // Should be overridden by event.channel
        },
        enrichments: {
          message: 'Hello {{user.displayName}} from {{channel}} (v{{version}})',
          annotations: [
            { id: 'a1', kind: 'custom', source: 'rule', createdAt: '2026-01-01T00:00:00Z', label: 'label-{{v}}', value: 'value-{{source}}' }
          ] as AnnotationV1[],
          candidates: [
            { id: 'c1', kind: 'text', source: 'rule', createdAt: '2026-01-01T00:00:00Z', status: 'proposed', priority: 1, text: 'Reply to {{user.displayName}}', reason: 'Because of {{message.text}}' }
          ] as CandidateV1[]
        },
      } as any,
    ];

    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules);

    expect(evtOut.message?.text).toBe('Hello Alice from #general (v2.0)');
    
    expect(evtOut.annotations?.[0].label).toBe('label-2');
    expect(evtOut.annotations?.[0].value).toBe('value-test');

    expect(evtOut.candidates?.[0].text).toBe('Reply to Alice');
    expect(evtOut.candidates?.[0].reason).toBe('Because of Hello');
  });

  it('provides now and ts in interpolation context', async () => {
     const rules: RuleDoc[] = [
      {
        id: 'r-time', enabled: true, priority: 1,
        logic: 'true',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {
          message: 'Time is {{now}}, epoch is {{ts}}',
        },
      } as any,
    ];

    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules);

    expect(evtOut.message?.text).toMatch(/Time is \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(evtOut.message?.text).toMatch(/epoch is \d+/);
  });

  it('handles missing variables by rendering empty strings (standard Mustache)', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-missing', enabled: true, priority: 1,
        logic: 'true',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {
          message: 'Missing: {{missing_var}}',
        },
      } as any,
    ];

    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules);

    expect(evtOut.message?.text).toBe('Missing: ');
  });

  it('allows access to config in logic context', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-config', enabled: true, priority: 1,
        // Match only if botUsername in config is 'TestBot'
        logic: JSON.stringify({ '==': [{ var: 'config.botUsername' }, 'TestBot'] }),
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {
          message: 'Matched with {{config.botUsername}}',
        },
      } as any,
    ];

    const engine = new RouterEngine();
    const config = { botUsername: 'TestBot' } as any;
    
    // Should match
    const res1 = await engine.route(baseEvt, rules, config);
    expect(res1.decision.matched).toBe(true);
    expect(res1.evtOut.message?.text).toBe('Matched with TestBot');

    // Should not match with different config
    const res2 = await engine.route(baseEvt, rules, { botUsername: 'OtherBot' } as any);
    expect(res2.decision.matched).toBe(false);
  });

  it('interpolates and replaces egress', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-egress', enabled: true, priority: 1,
        logic: 'true',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {
          egress: {
            destination: 'dynamic-{{channel}}',
            type: 'dm'
          }
        },
      } as any,
    ];

    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules);

    expect(evtOut.egress).toEqual({
      destination: 'dynamic-#general',
      type: 'dm'
    });
  });

  it('adds matchedRuleIds and chosenRuleId to event metadata', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'rule-1', enabled: true, priority: 10,
        logic: 'true',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {},
      } as any,
      {
        id: 'rule-2', enabled: true, priority: 20,
        logic: 'true',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {},
      } as any,
      {
        id: 'rule-3', enabled: true, priority: 30,
        logic: 'false',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {},
      } as any,
    ];

    const engine = new RouterEngine();
    const { evtOut, decision } = await engine.route(baseEvt, rules);

    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('rule-1');
    expect(decision.matchedRuleIds).toEqual(['rule-1', 'rule-2']);

    expect(evtOut.metadata).toBeDefined();
    expect(evtOut.metadata?.matchedRuleIds).toEqual(['rule-1', 'rule-2']);
    expect(evtOut.metadata?.chosenRuleId).toBe('rule-1');
  });

  it('sets chosenRuleId to null and matchedRuleIds to empty array when no match', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'rule-fail', enabled: true, priority: 1,
        logic: 'false',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {},
      } as any,
    ];

    const engine = new RouterEngine();
    const { evtOut, decision } = await engine.route(baseEvt, rules);

    expect(decision.matched).toBe(false);
    expect(decision.matchedRuleIds).toEqual([]);
    expect(evtOut.metadata?.matchedRuleIds).toEqual([]);
    expect(evtOut.metadata?.chosenRuleId).toBeNull();
  });
});
