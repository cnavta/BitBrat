import { describeService } from './cloudrun';

jest.mock('../../orchestration/exec', () => ({
  execCmd: jest.fn(async (_cmd: string, _args: string[]) => {
    const data = {
      metadata: { name: 'svc' },
      status: { url: 'https://svc.run.app', latestReadyRevisionName: 'svc-00001-abc', conditions: [{ type: 'Ready', status: 'True' }] },
    };
    return { code: 0, stdout: JSON.stringify(data), stderr: '' } as any;
  }),
}));

describe('Cloud Run describe (fallback)', () => {
  it('parses gcloud JSON output', async () => {
    const res = await describeService('p', 'r', 'svc');
    expect(res).toEqual(expect.objectContaining({ name: 'svc', url: 'https://svc.run.app', latestReadyRevision: 'svc-00001-abc' }));
  });
});
