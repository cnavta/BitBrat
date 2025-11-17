import { getRequiredApis, enableApis } from './apis';

jest.mock('../../orchestration/exec', () => ({
  execCmd: jest.fn(async () => ({ code: 0, stdout: 'enabled', stderr: '' })),
}));

describe('gcp apis provider', () => {
  it('returns a stable list of required apis', () => {
    const list = getRequiredApis('dev');
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain('run.googleapis.com');
    expect(list).toContain('cloudbuild.googleapis.com');
    expect(list).toContain('artifactregistry.googleapis.com');
    expect(list).toContain('compute.googleapis.com');
    expect(list).toContain('vpcaccess.googleapis.com');
    expect(list).toContain('secretmanager.googleapis.com');
    expect(list).toContain('logging.googleapis.com');
    expect(list).toContain('certificatemanager.googleapis.com');
    expect(list).toContain('serviceusage.googleapis.com');
  });

  it('dry-run returns intent without calling gcloud', async () => {
    const res = await enableApis({ projectId: 'p1', env: 'dev', dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.attempted.length).toBeGreaterThan(0);
    expect(res.results.every((r) => r.code === 0)).toBe(true);
  });
});
