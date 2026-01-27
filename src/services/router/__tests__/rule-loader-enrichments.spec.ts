import { RuleLoader } from '../rule-loader';

function makeDoc(id: string, data: any) {
  return { id, data: () => data } as any;
}

function makeSnap(docs: any[]) {
  return { docs } as any;
}

describe('RuleLoader Enrichments', () => {
  let rl: RuleLoader;
  let snapshotCb: (s: any) => void;
  let db: any;

  beforeEach(async () => {
    rl = new RuleLoader();
    db = {
      collection: () => ({
        get: async () => makeSnap([]),
        onSnapshot: (cb: (s: any) => void) => {
          snapshotCb = cb;
          return () => {};
        },
      }),
    } as any;
    await rl.start(db);
  });

  it('correctly parses enrichments from new structure', () => {
    const data = {
      enabled: true,
      priority: 10,
      logic: "{}",
      routingSlip: [{ id: 'r', nextTopic: 't1' }],
      enrichments: {
        message: "Hello world",
        randomCandidate: true,
        candidates: [
          {
            id: 'c1',
            kind: 'text',
            source: 'test',
            createdAt: '2026-01-01T00:00:00Z',
            status: 'proposed',
            priority: 1
          }
        ]
      }
    };
    snapshotCb(makeSnap([makeDoc('rule1', data)]));
    const rules = rl.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].enrichments.message).toBe("Hello world");
    expect(rules[0].enrichments.randomCandidate).toBe(true);
    expect(rules[0].enrichments.candidates).toHaveLength(1);
    expect(rules[0].enrichments.candidates![0].id).toBe('c1');
  });

  it('maintains backward compatibility for top-level annotations', () => {
    const data = {
      enabled: true,
      priority: 10,
      logic: "{}",
      routingSlip: [{ id: 'r', nextTopic: 't1' }],
      annotations: [
        {
          id: 'a1',
          kind: 'intent',
          source: 'test',
          createdAt: '2026-01-01T00:00:00Z'
        }
      ]
    };
    snapshotCb(makeSnap([makeDoc('rule1', data)]));
    const rules = rl.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].enrichments.annotations).toHaveLength(1);
    expect(rules[0].enrichments.annotations![0].id).toBe('a1');
  });

  it('prefers enrichments.annotations over top-level annotations', () => {
    const data = {
      enabled: true,
      priority: 10,
      logic: "{}",
      routingSlip: [{ id: 'r', nextTopic: 't1' }],
      annotations: [
        {
          id: 'old',
          kind: 'intent',
          source: 'test',
          createdAt: '2026-01-01T00:00:00Z'
        }
      ],
      enrichments: {
        annotations: [
          {
            id: 'new',
            kind: 'intent',
            source: 'test',
            createdAt: '2026-01-01T00:00:00Z'
          }
        ]
      }
    };
    snapshotCb(makeSnap([makeDoc('rule1', data)]));
    const rules = rl.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].enrichments.annotations).toHaveLength(1);
    expect(rules[0].enrichments.annotations![0].id).toBe('new');
  });
});
