import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2, EgressV1 } from '../../../types/events';

describe('RouterEngine – egress enrichment', () => {
  const baseEvt: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-egress-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text: '!go' },
    egress: { destination: 'original.topic', type: 'twitch:irc' }
  } as any;

  it('overwrites egress when rule defines one', () => {
    const newEgress: EgressV1 = { destination: 'discord.topic', type: 'discord' };
    const rules: RuleDoc[] = [
      {
        id: 'r-egress', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.command.v1' ] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
        egress: newEgress,
      },
    ];

    const engine = new RouterEngine();
    const { evtOut } = engine.route(baseEvt, rules);

    expect(evtOut.egress).toEqual(newEgress);
  });

  it('adds egress when rule defines one and event has none', () => {
    const evtNoEgress = { ...baseEvt, egress: undefined };
    const newEgress: EgressV1 = { destination: 'discord.topic', type: 'discord' };
    const rules: RuleDoc[] = [
      {
        id: 'r-egress', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.command.v1' ] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
        egress: newEgress,
      },
    ];

    const engine = new RouterEngine();
    const { evtOut } = engine.route(evtNoEgress as any, rules);

    expect(evtOut.egress).toEqual(newEgress);
  });

  it('preserves existing egress when rule has no egress override', () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-no-egress', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.command.v1' ] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.llmbot.v1' }],
      },
    ];

    const engine = new RouterEngine();
    const { evtOut } = engine.route(baseEvt, rules);

    expect(evtOut.egress).toEqual(baseEvt.egress);
  });
});
