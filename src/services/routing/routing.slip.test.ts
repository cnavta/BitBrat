import { ensureSlip, findNextActionable, isComplete, markStepResult } from './slip';
import { InternalEventV1, RoutingStep } from '../../types/events';

describe('slip utils', () => {
  it('ensures slip and finds next actionable', () => {
    const evt: InternalEventV1 = {
      envelope: { v: '1', source: 'ingress', correlationId: 'c1' },
      type: 'chat.message.v1',
      channel: '#chan',
      payload: { text: 'hello' },
    } as any;
    const planned: RoutingStep[] = [
      { id: 'router', status: 'OK' },
      { id: 'llm-bot', status: 'PENDING' },
      { id: 'egress', status: 'PENDING' },
    ];
    const slip = ensureSlip(evt.envelope, planned);
    const next = findNextActionable(slip);
    expect(next).not.toBeNull();
    expect(next!.step.id).toBe('llm-bot');
  });

  it('isComplete returns true when all steps are OK or SKIP', () => {
    const slip: RoutingStep[] = [
      { id: 'router', status: 'OK' },
      { id: 'llm-bot', status: 'OK' },
      { id: 'egress', status: 'SKIP' },
    ];
    expect(isComplete(slip)).toBe(true);
  });
});
