import { RuleLoader } from '../rule-loader';

function makeDoc(id: string, data: any) {
  return { id, data: () => data } as any;
}

function makeSnap(docs: any[]) {
  return { docs } as any;
}

describe('RuleLoader', () => {
  it('warm loads rules, validates and sorts by priority asc and id', async () => {
    const docs = [
      makeDoc('b', { enabled: true, priority: 20, logic: {}, routingSlip: [{ id: 'r', nextTopic: 't1' }] }),
      makeDoc('a', { enabled: true, priority: 10, logic: {}, routingSlip: [{ id: 'r', nextTopic: 't2' }] }),
      makeDoc('c', { enabled: false, priority: 5, logic: {}, routingSlip: [{ id: 'r', nextTopic: 't3' }] }), // disabled → ignored
      makeDoc('d', { enabled: true, priority: 'x', logic: {}, routingSlip: [{ id: 'r', nextTopic: 't4' }] }), // invalid priority
      makeDoc('e', { enabled: true, priority: 10, logic: {}, routingSlip: [] }), // invalid slip
    ];
    const warmSnap = makeSnap(docs);

    let snapshotCb: (s: any) => void = () => {};
    const db = {
      collection: () => ({
        get: async () => warmSnap,
        onSnapshot: (cb: (s: any) => void) => {
          snapshotCb = cb;
          // return unsubscribe
          return () => {};
        },
      }),
    } as any;

    const rl = new RuleLoader();
    await rl.start(db);
    const rules = rl.getRules();
    expect(rules.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rules[0].priority).toBe(10);
    expect(rules[1].priority).toBe(20);

    // Apply snapshot update: swap priorities and add tie to check tie-breaker by id
    const updateSnap = makeSnap([
      makeDoc('b', { enabled: true, priority: 5, logic: {}, routingSlip: [{ id: 'r', nextTopic: 't1' }] }),
      makeDoc('a', { enabled: true, priority: 5, logic: {}, routingSlip: [{ id: 'r', nextTopic: 't2' }] }),
      makeDoc('c', { enabled: true, priority: 5, logic: {}, routingSlip: [{ id: 'r', nextTopic: 't3' }] }),
    ]);
    snapshotCb(updateSnap);
    const rules2 = rl.getRules();
    // priority equal -> id ascending a, b, c
    expect(rules2.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
