import { ensureSlip, findNextActionable, isComplete } from './slip';
import { InternalEventV2, RoutingStep } from '../../types/events';

describe('slip utils', () => {
  it('ensures slip and finds next actionable', () => {
    const evt: InternalEventV2 = {
      v: '2',
      correlationId: 'c1',
      type: 'chat.message.v1',
      ingress: { ingressAt: '2026-01-29T22:00:00Z', source: 'ingress', channel: '#chan' },
      identity: { external: { id: 'u1', platform: 'test' } },
      egress: { destination: 'test' },
      payload: { text: 'hello' },
    } as any;
    const planned: RoutingStep[] = [
      { id: 'router', status: 'OK' },
      { id: 'llm-bot', status: 'PENDING' },
      { id: 'egress', status: 'PENDING' },
    ];
    const slip = ensureSlip(evt, planned);
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
