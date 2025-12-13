import { BaseServer } from '../../common/base-server';

// Firestore mock (collection -> doc -> set)
function makeFirestoreMock() {
  const set = jest.fn(async (_data: any, _opts?: any) => {});
  const doc = jest.fn((_id: string) => ({ set }));
  const collection = jest.fn((_name: string) => ({ doc }));
  return { collection, __fns: { set, doc, collection } } as any;
}

describe('persistence-service integration (mocked messaging + firestore)', () => {
  const handlers: { destination: string; handler: (msg: any, attr: any, ctx: any) => Promise<void> }[] = [];
  const firestore = makeFirestoreMock();

  beforeAll(() => {
    // Spy on onMessage to capture handlers instead of wiring a real subscriber
    jest
      .spyOn(BaseServer.prototype as any, 'onMessage')
      .mockImplementation(async (opts: any, handler: any) => {
        const destination = opts?.destination || opts?.subject || 'unknown';
        handlers.push({ destination, handler });
        // return dummy unsubscribe fn
        return () => {};
      });

    // Make getResource('firestore') return our mock
    jest
      .spyOn(BaseServer.prototype as any, 'getResource')
      .mockImplementation((...args: any[]) => (args[0] === 'firestore' ? firestore : undefined));

    // Import and bootstrap the app (registers handlers via our spies)
    const mod = require('../../apps/persistence-service');
    // Ensure app is created to trigger setup
    if (typeof mod.createApp === 'function') {
      mod.createApp();
    }
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('ingress handler persists event document', async () => {
    const h = handlers.find((x) => x.destination === 'internal.ingress.v1');
    expect(h).toBeTruthy();
    const ack = jest.fn(async () => {});
    const ctx = { ack };
    const msg = {
      v: '1',
      source: 'ingress.twitch',
      correlationId: 'it-1',
      type: 'chat.message.v1',
      message: { id: 'm', role: 'user', text: 'hello' },
    };
    await h!.handler(msg, {}, ctx);
    expect(ack).toHaveBeenCalled();
    expect(firestore.__fns.collection).toHaveBeenCalledWith('events');
    expect(firestore.__fns.doc).toHaveBeenCalledWith('it-1');
    const call = firestore.__fns.set.mock.calls[0];
    expect(call[1]).toEqual({ merge: true });
    expect(call[0]).toMatchObject({ correlationId: 'it-1', status: 'INGESTED' });
  });

  test('finalize handler applies egress finalization patch', async () => {
    const h = handlers.find((x) => x.destination === 'internal.persistence.finalize.v1');
    expect(h).toBeTruthy();
    const ack = jest.fn(async () => {});
    const ctx = { ack };
    const msg = {
      correlationId: 'it-2',
      destination: 'egress://default',
      deliveredAt: '2024-01-01T00:00:00Z',
      providerMessageId: 'pm-1',
      status: 'SENT',
      metadata: { ok: true },
    };
    await h!.handler(msg, {}, ctx);
    expect(ack).toHaveBeenCalled();
    const call = firestore.__fns.set.mock.calls[firestore.__fns.set.mock.calls.length - 1];
    expect(call[1]).toEqual({ merge: true });
    expect(call[0]).toMatchObject({ status: 'FINALIZED', egress: { status: 'SENT', destination: 'egress://default' } });
  });
});
