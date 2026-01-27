import { RouterEngine } from '../src/services/routing/router-engine';
import type { RuleDoc } from '../src/services/router/rule-loader';
import type { InternalEventV2 } from '../src/types/events';
import { INTERNAL_EGRESS_V1 } from '../src/types/events';

describe('Sprint 225: Egress destination enrichment', () => {
  const baseEvt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-egress-dest',
    routingSlip: [],
    type: 'chat.command.v1',
    channel: '#original',
    userId: 'u1',
    egress: {
      destination: '#original',
      type: 'chat'
    },
    message: { id: 'm1', role: 'user', text: '!lurk', rawPlatformPayload: {} },
  } as any;

  it('correctly enriches egress.destination even with empty routingSlip', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-lurk', enabled: true, priority: 1,
        logic: JSON.stringify({ 'text_contains': [{ var: 'message.text' }, '!lurk'] }),
        routingSlip: [], // EMPTY SLIP
        enrichments: {
          egress: {
            destination: '#new-destination',
            type: 'dm'
          }
        },
      } as any,
    ];

    const engine = new RouterEngine();
    const { slip, decision, evtOut } = await engine.route(baseEvt, rules);

    expect(decision.matched).toBe(true);
    expect(decision.selectedTopic).toBe(INTERNAL_EGRESS_V1);
    
    // Check if egress was enriched
    expect(evtOut.egress).toBeDefined();
    expect(evtOut.egress.destination).toBe('#new-destination');
    expect(evtOut.egress.type).toBe('dm');
    
    // Check if channel was also updated to match the new destination
    expect(evtOut.channel).toBe('#new-destination');
  });

  it('correctly interpolates Mustache templates in egress.destination', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-lurk', enabled: true, priority: 1,
        logic: JSON.stringify({ 'text_contains': [{ var: 'message.text' }, '!lurk'] }),
        routingSlip: [], 
        enrichments: {
          egress: {
            destination: 'user:{{userId}}',
            type: 'dm'
          }
        },
      } as any,
    ];

    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules);

    expect(evtOut.egress.destination).toBe('user:u1');
  });
});
