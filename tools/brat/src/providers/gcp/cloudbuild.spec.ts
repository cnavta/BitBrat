import { extractBuildIdFromGcloudOutput } from './cloudbuild';

describe('cloudbuild extractBuildIdFromGcloudOutput', () => {
  it('extracts build id from Created URL line', () => {
    const out = 'Created [https://cloudbuild.googleapis.com/v1/projects/bitbrat-local/locations/global/builds/d7d84bc8-691a-4da4-a574-6f7d15df3a66].\nLogs are available at ...';
    const id = extractBuildIdFromGcloudOutput(out);
    expect(id).toBe('d7d84bc8-691a-4da4-a574-6f7d15df3a66');
  });

  it('returns null when no id present', () => {
    const out = 'some unrelated output';
    const id = extractBuildIdFromGcloudOutput(out);
    expect(id).toBeNull();
  });
});
