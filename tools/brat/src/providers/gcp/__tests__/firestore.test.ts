import {
  resolveProjectId,
  resolveDatabaseId,
  resolveFirestoreTarget,
  getBackupFirestore,
  DEFAULT_EMULATOR_PROJECT,
} from '../firestore';
import { ConfigurationError } from '../../../orchestration/errors';
import { TEST_EMULATOR_HOST, isEmulatorReachable } from '../../../backup/testing/emulator-utils';

describe('brat Firestore provider — target resolution', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    delete process.env.PROJECT_ID;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.FIRESTORE_DATABASE_ID;
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('resolves project id from explicit flag over env', () => {
    process.env.PROJECT_ID = 'from-env';
    expect(resolveProjectId('explicit-id')).toBe('explicit-id');
  });

  it('falls back to PROJECT_ID/GCLOUD_PROJECT env', () => {
    process.env.GCLOUD_PROJECT = 'gcloud-proj';
    expect(resolveProjectId()).toBe('gcloud-proj');
  });

  it('throws ConfigurationError when no project id and not an emulator', () => {
    expect(() => resolveProjectId()).toThrow(ConfigurationError);
  });

  it('defaults the emulator project when none supplied', () => {
    expect(resolveProjectId(undefined, { emulator: true })).toBe(DEFAULT_EMULATOR_PROJECT);
  });

  it('defaults database id to (default) and honors FIRESTORE_DATABASE_ID', () => {
    expect(resolveDatabaseId()).toBe('(default)');
    expect(resolveDatabaseId('named-db')).toBe('named-db');
    process.env.FIRESTORE_DATABASE_ID = 'env-db';
    expect(resolveDatabaseId()).toBe('env-db');
  });

  it('describes a GCP target (ADC) when no emulator host', () => {
    const t = resolveFirestoreTarget({ projectId: 'p1' });
    expect(t.emulatorHost).toBeUndefined();
    expect(t.projectId).toBe('p1');
    expect(t.databaseId).toBe('(default)');
    expect(t.description).toContain('GCP Firestore');
  });

  it('describes an emulator target from FIRESTORE_EMULATOR_HOST', () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    const t = resolveFirestoreTarget({});
    expect(t.emulatorHost).toBe('127.0.0.1:8080');
    expect(t.projectId).toBe(DEFAULT_EMULATOR_PROJECT);
    expect(t.description).toContain('emulator');
  });
});

describe('brat Firestore provider — emulator connection (Gate G2)', () => {
  it('connects to the Firestore emulator and round-trips a document', async () => {
    const reachable = await isEmulatorReachable();
    if (!reachable) {
      console.warn(`[skip] Firestore emulator not reachable at ${TEST_EMULATOR_HOST}; skipping G2 connection test.`);
      return;
    }
    const { db, target } = getBackupFirestore({ emulatorHost: TEST_EMULATOR_HOST, projectId: 'bitbrat-local' });
    expect(target.emulatorHost).toBe(TEST_EMULATOR_HOST);
    const ref = db.collection('__brat_provider_probe').doc('doc1');
    await ref.set({ hello: 'world', n: 7 });
    const snap = await ref.get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ hello: 'world', n: 7 });
    await ref.delete();
  });
});
