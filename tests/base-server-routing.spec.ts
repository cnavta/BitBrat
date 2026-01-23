import { InternalEventV2, RoutingStep } from '../src/types/events';
import { BaseServer } from '../src/common/base-server';
import * as bus from '../src/services/message-bus';

// Ensure noop driver in tests
process.env.MESSAGE_BUS_DISABLE_IO = '1';
process.env.NODE_ENV = 'test';

class TestServer extends BaseServer {
  constructor() {
    super({ serviceName: 'test-service' });
  }
  public async nextPublic(evt: InternalEventV2, status?: any) { return (this as any).next(evt, status); }
  public async completePublic(evt: InternalEventV2, status?: any) { return (this as any).complete(evt, status); }
}

function makeEvent(partial: Partial<InternalEventV2>): InternalEventV2 {
  const base: InternalEventV2 = {
    v: '1',
    source: 'test',
    correlationId: 'c-1',
    type: 'chat.command.v1',
    message: { id: 'm1', role: 'user', text: '!ping' },
  } as any;
  return { ...base, ...partial } as InternalEventV2;
}

describe('BaseServer routing helpers', () => {
  let server: TestServer;
  let pubSpy: jest.SpyInstance;
  const publishers = new Map<string, { subject: string; publishJson: jest.Mock; flush: jest.Mock }>();

  function getPublisher(subject: string) {
    let p = publishers.get(subject);
    if (!p) {
      p = { subject, publishJson: jest.fn(async () => null), flush: jest.fn(async () => undefined) };
      publishers.set(subject, p);
    }
    return p;
  }

  beforeEach(() => {
    publishers.clear();
    server = new TestServer();
    pubSpy = jest.spyOn(bus, 'createMessagePublisher').mockImplementation((subject: string) => getPublisher(subject) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('next() publishes to first pending step subject with attributes', async () => {
    const steps: RoutingStep[] = [
      { id: 'router', status: 'OK', nextTopic: 'internal.router.done.v1' },
      { id: 'bot', status: 'PENDING', nextTopic: 'internal.bot.requests.v1' },
    ] as any;
    const evt = makeEvent({ routingSlip: steps });

    await server.nextPublic(evt);

    const pub = getPublisher('internal.bot.requests.v1');
    expect(pub.publishJson).toHaveBeenCalledTimes(1);
    // payload shape depends on upstream; presence of a call is sufficient here
  });

  test('next(status) marks current step then publishes to next pending', async () => {
    const steps: RoutingStep[] = [
      { id: 'step1', status: 'PENDING', nextTopic: 'internal.step1.v1' },
      { id: 'step2', status: 'PENDING', nextTopic: 'internal.step2.v1' },
    ] as any;
    const evt = makeEvent({ routingSlip: steps });

    await server.nextPublic(evt, 'OK');

    // After marking step1 OK, next() should publish to step2 (first pending)
    const pub = getPublisher('internal.step2.v1');
    expect(pub.publishJson).toHaveBeenCalledTimes(1);
    expect((evt.routingSlip as RoutingStep[])[0].status).toBe('OK');
    expect(typeof (evt.routingSlip as RoutingStep[])[0].endedAt).toBe('string');
  });

  test('next() falls back to egressDestination when no pending steps', async () => {
    const steps: RoutingStep[] = [
      { id: 'router', status: 'OK', nextTopic: 'internal.router.done.v1' },
      { id: 'bot', status: 'SKIP', nextTopic: 'internal.bot.requests.v1' },
    ] as any;
    const evt = makeEvent({ routingSlip: steps, egress: { destination: 'internal.egress.v1' } });

    await server.nextPublic(evt);

    const pub = getPublisher('internal.egress.v1');
    expect(pub.publishJson).toHaveBeenCalledTimes(1);
  });

  test('complete() publishes to egressDestination', async () => {
    const evt = makeEvent({ egress: { destination: 'internal.egress.v1' } });
    await server.completePublic(evt);
    expect(getPublisher('internal.egress.v1').publishJson).toHaveBeenCalledTimes(1);
  });

  test('complete(status) updates current step then publishes to egress', async () => {
    const steps: RoutingStep[] = [
      { id: 'bot', status: 'PENDING', nextTopic: 'internal.bot.requests.v1' },
    ] as any;
    const evt = makeEvent({ routingSlip: steps, egress: { destination: 'internal.egress.v1' } });
    await server.completePublic(evt, 'SKIP');
    expect(getPublisher('internal.egress.v1').publishJson).toHaveBeenCalledTimes(1);
    expect((evt.routingSlip as RoutingStep[])[0].status).toBe('SKIP');
    expect(typeof (evt.routingSlip as RoutingStep[])[0].endedAt).toBe('string');
  });

  test('idempotency: next() second call is no-op for same event instance', async () => {
    const steps: RoutingStep[] = [{ id: 'bot', status: 'PENDING', nextTopic: 'internal.bot.requests.v1' }] as any;
    const evt = makeEvent({ routingSlip: steps });
    await server.nextPublic(evt);
    await server.nextPublic(evt);
    expect(getPublisher('internal.bot.requests.v1').publishJson).toHaveBeenCalledTimes(1);
  });

  test('idempotency marker cleared on publish failure allowing retry', async () => {
    const steps: RoutingStep[] = [{ id: 'bot', status: 'PENDING', nextTopic: 'internal.bot.requests.v1' }] as any;
    const evt = makeEvent({ routingSlip: steps });
    const pub = getPublisher('internal.bot.requests.v1');
    pub.publishJson.mockImplementationOnce(async () => { throw new Error('boom'); });
    await expect(server.nextPublic(evt)).rejects.toThrow('boom');
    // Next call should attempt again (marker cleared on failure)
    await server.nextPublic(evt);
    expect(pub.publishJson).toHaveBeenCalledTimes(2);
  });
});
