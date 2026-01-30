import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2, RoutingStep } from '../../../types/events';

describe('RouterEngine + JsonLogic custom operators integration', () => {
  const evt: InternalEventV2 = {
    v: '2', source: 'test', correlationId: 'c-ops',
    type: 'chat.command.v1', channel: '#ch', userId: 'u1',
    user: { id: 'u1', roles: ['Mod'] },
    routingSlip: [
      { id: 'router', v: '2', status: 'OK', attempt: 1, nextTopic: 'internal.llmbot.v1' },
      { id: 'llm-bot', v: '2', status: 'OK', attempt: 1 }, // terminal OK (no nextTopic)
    ] as RoutingStep[],
    message: { id: 'm1', role: 'user', text: '!PiNg', rawPlatformPayload: { text: '!PiNg' } },
  } as any;

  it('evaluates rules using ci_eq and re_test', async () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-no', enabled: true, priority: 1,
        logic: JSON.stringify({ '==': [ { var: 'type' }, 'chat.message.v1' ] }),
        routingSlip: [{ id: 'router', nextTopic: 'internal.never.v1' }],
        enrichments: {},
      } as any,
      {
        id: 'r-yes', enabled: true, priority: 2,
        logic: JSON.stringify({
          and: [
            { ci_eq: [ { var: 'message.text' }, '!ping' ] },
            { re_test: [ { var: 'message.text' }, ['^!p', 'i'] ] },
            { slip_complete: [ { var: 'routingSlip' } ] },
          ],
        }),
        routingSlip: [{ id: 'router', v: '2', nextTopic: 'internal.llmbot.v1' }],
        enrichments: {},
      } as any,
    ];
    const engine = new RouterEngine();
    const { decision, slip } = await engine.route(evt, rules);
    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('r-yes');
    expect(slip[0].nextTopic).toBe('internal.llmbot.v1');
  });
});
