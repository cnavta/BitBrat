import { RuleLoader } from '../rule-loader';

describe('RuleLoader hardening', () => {
  it('continues when warm-load throws and leaves cache empty', async () => {
    const db = {
      collection: () => ({
        get: async () => { throw new Error('emulator not available'); },
        onSnapshot: (cb: any) => { cb({ docs: [] }); return () => {}; },
      }),
    } as any;
    const rl = new RuleLoader();
    await rl.start(db);
    expect(Array.isArray(rl.getRules())).toBe(true);
    expect(rl.getRules().length).toBe(0);
  });

  it('continues when subscribe throws', async () => {
    const warmDocs = [{ id: 'x', data: () => ({ enabled: true, priority: 1, logic: {}, routingSlip: [{ id: 'r', nextTopic: 't' }] }) }];
    const db = {
      collection: () => ({
        get: async () => ({ docs: warmDocs }),
        onSnapshot: (_cb: any) => { throw new Error('listen failed'); },
      }),
    } as any;
    const rl = new RuleLoader();
    await rl.start(db);
    // Warm load should still have populated the cache despite subscribe failure
    expect(rl.getRules().length).toBe(1);
    expect(rl.getRules()[0].id).toBe('x');
  });
});
