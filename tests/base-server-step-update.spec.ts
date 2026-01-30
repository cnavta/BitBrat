import { BaseServer } from '../src/common/base-server';
import { InternalEventV2, RoutingStep } from '../src/types/events';

class TestServer extends BaseServer {
  constructor() { super({ serviceName: 'test-service' }); }
  public update(evt: InternalEventV2, upd: any) { return (this as any).updateCurrentStep(evt, upd); }
}

function makeEvent(partial: Partial<InternalEventV2> = {}): InternalEventV2 {
  const base: InternalEventV2 = {
    v: '2',
    source: 'test',
    correlationId: 'c-up-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text: '!ping' },
  } as any;
  return { ...base, ...partial } as InternalEventV2;
}

describe('BaseServer.updateCurrentStep()', () => {
  let server: TestServer;
  beforeEach(() => { server = new TestServer(); });

  test('returns null when no routingSlip', () => {
    const evt = makeEvent({ routingSlip: undefined });
    const res = server.update(evt, { status: 'OK' });
    expect(res).toBeNull();
  });

  test('updates first pending step status and sets endedAt on terminal', () => {
    const slip: RoutingStep[] = [
      { id: 'a', status: 'OK' },
      { id: 'b', status: 'PENDING' },
      { id: 'c', status: 'PENDING' },
    ] as any;
    const evt = makeEvent({ routingSlip: slip });
    const res = server.update(evt, { status: 'OK' });
    expect(res).not.toBeNull();
    const { index, step } = res!;
    expect(index).toBe(1);
    expect(step.status).toBe('OK');
    expect(typeof step.endedAt).toBe('string');
    // Other steps unchanged
    expect(slip[0].status).toBe('OK');
    expect(slip[2].status).toBe('PENDING');
  });

  test('appendNote appends to notes when provided', () => {
    const slip: RoutingStep[] = [{ id: 'a', status: 'PENDING', notes: 'n1' }] as any;
    const evt = makeEvent({ routingSlip: slip });
    const res = server.update(evt, { appendNote: 'n2' });
    expect(res).not.toBeNull();
    expect(slip[0].notes).toBe('n1\nn2');
  });

  test('notes replaces existing notes when provided', () => {
    const slip: RoutingStep[] = [{ id: 'a', status: 'PENDING', notes: 'old' }] as any;
    const evt = makeEvent({ routingSlip: slip });
    server.update(evt, { notes: 'new' });
    expect(slip[0].notes).toBe('new');
  });

  test('error can be set and cleared', () => {
    const slip: RoutingStep[] = [{ id: 'a', status: 'PENDING' }] as any;
    const evt = makeEvent({ routingSlip: slip });
    server.update(evt, { error: { code: 'X', message: 'boom', retryable: false } });
    expect((slip[0] as any).error?.code).toBe('X');
    server.update(evt, { error: null });
    expect((slip[0] as any).error).toBeNull();
  });
});
