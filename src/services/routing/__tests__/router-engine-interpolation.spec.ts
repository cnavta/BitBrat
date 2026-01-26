import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2, AnnotationV1, CandidateV1 } from '../../../types/events';

describe('RouterEngine – interpolation', () => {
  const baseEvt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-interp-1',
    type: 'chat.message.v1',
    channel: '#general',
    user: { displayName: 'Alice' },
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
    
    expect(evtOut.annotations?.[0].label).toBe('label-1');
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
});
