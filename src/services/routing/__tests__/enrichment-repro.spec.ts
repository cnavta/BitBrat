import { RouterEngine } from '../router-engine';
import { RuleLoader } from '../../router/rule-loader';
import type { InternalEventV2 } from '../../../types/events';

describe('Enrichment Robustness', () => {
  const baseEvt: InternalEventV2 = {
    v: '2',
    correlationId: 'c-repro',
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

  it('handles partial annotations and candidates by providing defaults', async () => {
    const rules = [
      {
        id: 'r-partial',
        enabled: true,
        priority: 1,
        logic: 'true',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {
          annotations: [
            { label: 'enriched-label', value: 'enriched-value' } // Missing required fields
          ],
          candidates: [
            { text: 'enriched-text' } // Missing required fields
          ]
        }
      }
    ];

    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules as any);

    expect(evtOut.annotations?.[0]).toMatchObject({
      label: 'enriched-label',
      value: 'enriched-value',
      kind: 'custom',
      source: 'rule:r-partial'
    });
    expect(evtOut.annotations?.[0].id).toBeDefined();
    expect(evtOut.annotations?.[0].createdAt).toBeDefined();

    expect(evtOut.candidates?.[0]).toMatchObject({
      text: 'enriched-text',
      kind: 'text',
      source: 'rule:r-partial',
      status: 'proposed'
    });
    expect(evtOut.candidates?.[0].id).toBeDefined();
    expect(evtOut.candidates?.[0].createdAt).toBeDefined();
  });

  it('handles egress without destination by falling back to original or empty', async () => {
    const rules = [
      {
        id: 'r-egress-no-dest',
        enabled: true,
        priority: 1,
        logic: 'true',
        routingSlip: [{ id: 'router', nextTopic: 'out' }],
        enrichments: {
          egress: {
            type: 'dm'
            // destination is missing
          }
        }
      }
    ];

    const engine = new RouterEngine();
    
    // Case 1: Original event has no egress
    const res1 = await engine.route(baseEvt, rules as any);
    expect(res1.evtOut.egress).toEqual({ type: 'dm', destination: '' });

    // Case 2: Original event has egress
    const evtWithEgress = { ...baseEvt, egress: { destination: 'orig-dest' } };
    const res2 = await engine.route(evtWithEgress as any, rules as any);
    expect(res2.evtOut.egress).toEqual({ type: 'dm', destination: 'orig-dest' });
  });

  it('correctly loads egress enrichment via RuleLoader', async () => {
    const loader = new RuleLoader();
    const rawRule = {
      enabled: true,
      priority: 10,
      logic: 'true',
      routingSlip: [{ id: 'router', nextTopic: 'out' }],
      enrichments: {
        egress: {
          destination: 'target-{{channel}}',
          type: 'chat'
        }
      }
    };

    // Simulate Firestore snapshot
    const mockSnap = {
      docs: [
        {
          id: 'rule-egress-loader',
          data: () => rawRule
        }
      ]
    };

    // Use internal method to refresh cache
    (loader as any).refreshFromSnapshot(mockSnap);
    
    const rules = loader.getRules();
    expect(rules[0].enrichments.egress).toEqual({
      destination: 'target-{{channel}}',
      type: 'chat'
    });

    const engine = new RouterEngine();
    const { evtOut } = await engine.route(baseEvt, rules);
    expect(evtOut.egress).toEqual({
      destination: 'target-#general',
      type: 'chat'
    });
  });
});
