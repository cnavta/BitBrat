import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { getBackupFirestore } from '../../providers/gcp/firestore';
import { exportConfig } from '../export';
import { importConfig } from '../import';
import { FORBIDDEN_PREFIXES } from '../registry';
import { TEST_EMULATOR_HOST, isEmulatorReachable } from '../testing/emulator-utils';

jest.setTimeout(30000);

const CONFIG_AND_LOG_COLLECTIONS = [
  'users', 'configs', 'personalities', 'sources', 'stream_observers', 'mcp_servers', 'schedules',
  'events', 'mutation_log', 'state', 'tool_usage',
];

describe('brat backup — emulator export -> wipe -> import round-trip (Gate G3/G4)', () => {
  let reachable = false;
  let db: Firestore;
  let target: any;

  beforeAll(async () => {
    reachable = await isEmulatorReachable();
    if (!reachable) return;
    const conn = getBackupFirestore({ emulatorHost: TEST_EMULATOR_HOST, projectId: 'bitbrat-local' });
    db = conn.db;
    target = conn.target;
  });

  async function wipeAll() {
    for (const c of CONFIG_AND_LOG_COLLECTIONS) {
      // listDocuments() (not get()) so phantom/missing parents that only hold subcollections are
      // also enumerated and recursively deleted between test runs.
      const refs = await db.collection(c).listDocuments();
      for (const ref of refs) {
        await db.recursiveDelete(ref);
      }
    }
  }

  async function seed() {
    // Config: users/u1 + roles subcollection
    await db.collection('users').doc('u1').set({
      name: 'Alice', createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    });
    await db.collection('users').doc('u1').collection('roles').doc('r1').set({ role: 'admin' });

    // Config: configs/routingRules + rules subcollection (auto-id-style preserved id)
    await db.collection('configs').doc('routingRules').set({ description: 'router config' });
    await db.collection('configs').doc('routingRules').collection('rules').doc('rule-1')
      .set({ name: 'vip-greeting', enabled: true });

    // Config: a PHANTOM parent — configs/phantomRules has NO fields of its own and exists only as a
    // path for its `rules` subcollection. A collection query (.get()) does NOT return such parents,
    // so this reproduces the bug where nested config (configs/<phantom>/rules) was silently dropped.
    await db.collection('configs').doc('phantomRules').collection('rules').doc('rule-2')
      .set({ name: 'phantom-greeting', enabled: false });

    // Config: personalities/bitbrat — bot personality definition (must be in the backup set).
    await db.collection('personalities').doc('bitbrat').set({
      name: 'BitBrat', text: 'You are BitBrat, a helpful AI assistant.', status: 'active', version: 1,
    });

    // Config: sources/s1 with volatile fields that must be stripped on export
    await db.collection('sources').doc('s1').set({
      channel: 'twitch-main', status: 'LIVE', viewerCount: 123, latencyMs: 12, lastError: 'none',
    });

    // Log/event collections that MUST be excluded from the backup
    await db.collection('events').doc('e1').set({ foo: 'bar' });
    await db.collection('mutation_log').doc('m1').set({ seq: 1 });
    await db.collection('state').doc('st1').set({ phase: 'running' });
    await db.collection('tool_usage').doc('t1').set({ tool: 'x' });
  }

  it('exports config only (logs excluded), preserving IDs/subcollections and stripping volatile fields', async () => {
    if (!reachable) { console.warn(`[skip] emulator not reachable at ${TEST_EMULATOR_HOST}`); return; }
    await wipeAll();
    await seed();

    const { envelope } = await exportConfig(db, target);

    // No forbidden/log collection may appear in the envelope.
    for (const key of Object.keys(envelope.collections)) {
      for (const forbidden of FORBIDDEN_PREFIXES) {
        expect(key.split('/')[0]).not.toBe(forbidden);
      }
    }
    expect(Object.keys(envelope.collections)).not.toContain('events');
    expect(Object.keys(envelope.collections)).not.toContain('mutation_log');

    // users/u1 + roles subcollection captured with IDs.
    const users = envelope.collections['users'];
    const u1 = users.find((d) => d.id === 'u1')!;
    expect(u1).toBeDefined();
    expect(u1.subcollections.roles[0].id).toBe('r1');
    expect((u1.subcollections.roles[0].data as any).role).toBe('admin');

    // sources/s1 volatile fields stripped, config field kept.
    const s1 = envelope.collections['sources'].find((d) => d.id === 's1')!;
    expect((s1.data as any).channel).toBe('twitch-main');
    expect(s1.data).not.toHaveProperty('status');
    expect(s1.data).not.toHaveProperty('viewerCount');
    expect(s1.data).not.toHaveProperty('latencyMs');

    // Regression: personalities collection must be captured in the backup envelope.
    const personalities = envelope.collections['personalities'];
    expect(personalities).toBeDefined();
    const bitbrat = personalities.find((d) => d.id === 'bitbrat')!;
    expect(bitbrat).toBeDefined();
    expect((bitbrat.data as any).name).toBe('BitBrat');
    expect((bitbrat.data as any).status).toBe('active');

    // configs/routingRules/rules/rule-1 nested.
    const routing = envelope.collections['configs'].find((d) => d.id === 'routingRules')!;
    expect(routing.subcollections.rules[0].id).toBe('rule-1');

    // Regression: the phantom parent (no own fields) must still be captured with its `rules`
    // subcollection, flagged `missing` and carrying no data of its own.
    const phantom = envelope.collections['configs'].find((d) => d.id === 'phantomRules')!;
    expect(phantom).toBeDefined();
    expect(phantom.missing).toBe(true);
    expect(phantom.data).toEqual({});
    expect(phantom.subcollections.rules[0].id).toBe('rule-2');
    expect((phantom.subcollections.rules[0].data as any).name).toBe('phantom-greeting');
  });

  it('imports into a wiped database restoring config (IDs + subcollections); logs stay empty', async () => {
    if (!reachable) { console.warn(`[skip] emulator not reachable at ${TEST_EMULATOR_HOST}`); return; }
    await wipeAll();
    await seed();

    const { envelope } = await exportConfig(db, target);

    // Wipe ALL collections (config + log) to simulate a blank instance.
    await wipeAll();

    // Dry-run first: must not write.
    const dry = await importConfig(db, envelope, { mode: 'skip' });
    expect(dry.dryRun).toBe(true);
    const afterDry = await db.collection('users').doc('u1').get();
    expect(afterDry.exists).toBe(false);

    // Real import.
    const res = await importConfig(db, envelope, { mode: 'skip', confirm: true });
    expect(res.dryRun).toBe(false);
    expect(res.totalOps).toBeGreaterThan(0);

    // Config restored with IDs + subcollections.
    const u1 = await db.collection('users').doc('u1').get();
    expect(u1.exists).toBe(true);
    expect(u1.data()!.name).toBe('Alice');
    expect(u1.data()!.createdAt).toBeInstanceOf(Timestamp);
    const r1 = await db.collection('users').doc('u1').collection('roles').doc('r1').get();
    expect(r1.data()!.role).toBe('admin');
    const rule = await db.collection('configs').doc('routingRules').collection('rules').doc('rule-1').get();
    expect(rule.data()!.name).toBe('vip-greeting');

    // The phantom parent's nested config is restored, and the parent itself stays a phantom
    // (no field data materialised) just as it was in the source.
    const phantomRule = await db.collection('configs').doc('phantomRules').collection('rules').doc('rule-2').get();
    expect(phantomRule.exists).toBe(true);
    expect(phantomRule.data()!.name).toBe('phantom-greeting');
    const phantomParent = await db.collection('configs').doc('phantomRules').get();
    expect(phantomParent.exists).toBe(false);
    // Personality definition restored intact.
    const persona = await db.collection('personalities').doc('bitbrat').get();
    expect(persona.exists).toBe(true);
    expect(persona.data()!.name).toBe('BitBrat');
    expect(persona.data()!.status).toBe('active');
    const s1 = await db.collection('sources').doc('s1').get();
    expect(s1.data()!.channel).toBe('twitch-main');
    expect(s1.data()).not.toHaveProperty('status');

    // Log collections were never in the backup and must remain empty after import.
    for (const c of ['events', 'mutation_log', 'state', 'tool_usage']) {
      const snap = await db.collection(c).get();
      expect(snap.empty).toBe(true);
    }
  });

  afterAll(async () => {
    if (reachable) await wipeAll();
  });
});
