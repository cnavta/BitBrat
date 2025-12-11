import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2 } from '../../../types/events';

describe('RouterEngine + JsonLogic custom operators integration', () => {
  const evt: InternalEventV2 = {
    v: '1', source: 'test', correlationId: 'c-ops',
    type: 'chat.command.v1', channel: '#ch', userId: 'u1',
    user: { id: 'u1', roles: ['Mod'] },
    message: { id: 'm1', role: 'user', text: '!PiNg', rawPlatformPayload: { text: '!PiNg' } },
  } as any;

  it('evaluates rules using ci_eq and re_test', () => {
    const rules: RuleDoc[] = [
      {
        id: 'r-no', enabled: true, priority: 1,
        logic: { '==': [ { var: 'type' }, 'chat.message.v1' ] } as any,
        routingSlip: [{ id: 'router', nextTopic: 'internal.never.v1' }],
      },
      {
        id: 'r-yes', enabled: true, priority: 2,
        logic: {
          and: [
            { ci_eq: [ { var: 'message.text' }, '!ping' ] },
            { re_test: [ { var: 'message.text' }, ['^!p', 'i'] ] },
          ],
        } as any,
        routingSlip: [{ id: 'router', v: '1', nextTopic: 'internal.llmbot.v1' }],
      },
    ];
    const engine = new RouterEngine();
    const { decision, slip } = engine.route(evt, rules);
    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('r-yes');
    expect(slip[0].nextTopic).toBe('internal.llmbot.v1');
  });
});
