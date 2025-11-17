import { getTriggerByName, createTrigger, updateTrigger, deleteTrigger, isTriggerEqual } from './cloudbuild-triggers';

jest.mock('../../orchestration/exec', () => ({
  execCmd: jest.fn(async (cmd: string, args: string[]) => {
    const key = args.join(' ');
    // dynamic response map using hints embedded in tests via global state
    const map = (global as any).__CB_RESP__ || {};
    const res = map[key];
    if (res) return res;
    return { code: 0, stdout: '[]', stderr: '' } as any;
  }),
}));

const setListResponse = (triggers: any[]) => {
  (global as any).__CB_RESP__ = {
    ['builds triggers list --project test --format json']: { code: 0, stdout: JSON.stringify(triggers), stderr: '' },
  };
};

describe('Cloud Build triggers adapter (fallback path)', () => {
  const projectId = 'test';

  beforeEach(() => {
    (global as any).__CB_RESP__ = {};
  });

  it('getTriggerByName returns null when not found', async () => {
    setListResponse([]);
    const res = await getTriggerByName(projectId, 'foo');
    expect(res).toBeNull();
  });

  it('createTrigger (dry-run) reports created when missing', async () => {
    setListResponse([]);
    const spec = { name: 'foo', configPath: 'cloudbuild.yaml', substitutions: {}, repoSource: { type: 'github' as const, repo: 'o/r', branchRegex: 'main' } };
    const res = await createTrigger(projectId, spec, true);
    expect(res.action).toBe('created');
  });

  it('updateTrigger no-ops when identical by diff', async () => {
    const existing = {
      id: '123', name: 'foo', filename: 'cloudbuild.yaml', substitutions: { A: 'B' }, github: { owner: 'o', name: 'r', push: { branch: 'main' } },
    } as any;
    setListResponse([existing]);
    const spec = { name: 'foo', configPath: 'cloudbuild.yaml', substitutions: { A: 'B' }, repoSource: { type: 'github' as const, repo: 'o/r', branchRegex: 'main' } };
    // sanity on equality helper
    expect(isTriggerEqual({ id: '123', name: 'foo', configPath: 'cloudbuild.yaml', substitutions: { A: 'B' }, repoSource: { type: 'github', repo: 'o/r', branchRegex: 'main' } }, spec)).toBe(true);
    const res = await updateTrigger(projectId, spec, false);
    expect(res.action).toBe('noop');
  });

  it('deleteTrigger returns noop when not found (even in dry-run)', async () => {
    setListResponse([]);
    const res = await deleteTrigger(projectId, 'nope', true);
    expect(res.action).toBe('noop');
  });
});
