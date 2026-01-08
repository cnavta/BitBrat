import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

import { renderUrlMapYaml, writeYamlFile } from '../../urlmap/renderer';
import { RendererInput } from '../../urlmap/schema';

// Mock execCmd used by importer
const execMock = jest.fn();
jest.mock('../../../orchestration/exec', () => ({
  execCmd: (...args: any[]) => execMock(...args),
}));

import { importUrlMap } from '../importer';

function makeRendererInput(): RendererInput {
  return {
    name: 'bitbrat-global-url-map',
    projectId: 'demo-project',
    env: 'dev',
    defaultDomain: 'api.bitbrat.ai',
    routes: [
      { pathPrefix: '/oauth', service: 'oauth-flow', rewritePrefix: '/' },
    ],
    defaultBackend: 'be-default',
  };
}

describe('URL map importer', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-urlmap-test-'));
  const urlMapFile = path.join(tmpDir, 'url-map.yaml');
  const desiredObj = renderUrlMapYaml(makeRendererInput());
  writeYamlFile(desiredObj, urlMapFile);

  beforeEach(() => {
    execMock.mockReset();
  });

  it('returns no-op when no drift detected', async () => {
    // First describe returns same YAML as desired
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump(desiredObj), stderr: '' });
    const res = await importUrlMap({ projectId: 'demo-project', env: 'dev', urlMapName: 'bitbrat-global-url-map', sourceYamlPath: urlMapFile, dryRun: false });
    expect(res.changed).toBe(false);
    expect(res.message).toMatch(/No drift/);
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][0]).toBe('gcloud');
    expect(execMock.mock.calls[0][1]).toContain('describe');
  });

  it('dry-run reports drift without importing', async () => {
    // Describe shows empty state
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump({}), stderr: '' });
    const res = await importUrlMap({ projectId: 'demo-project', env: 'dev', urlMapName: 'bitbrat-global-url-map', sourceYamlPath: urlMapFile, dryRun: true });
    expect(res.changed).toBe(true);
    expect(res.message).toMatch(/dry-run/);
    // Should not attempt import
    const cmds = execMock.mock.calls.map((c) => c[1].join(' ')).join('\n');
    expect(cmds).not.toMatch(/import/);
  });

  it('prod environment never imports automatically', async () => {
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump({}), stderr: '' });
    const res = await importUrlMap({ projectId: 'demo-project', env: 'prod', urlMapName: 'bitbrat-global-url-map', sourceYamlPath: urlMapFile, dryRun: false });
    expect(res.changed).toBe(true);
    expect(res.message).toMatch(/prod/);
    const cmds = execMock.mock.calls.map((c) => c[1].join(' ')).join('\n');
    expect(cmds).not.toMatch(/import/);
  });

  it('imports when drift detected in non-prod and verifies parity', async () => {
    // First describe shows empty
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump({}), stderr: '' });
    // Backend existence checks — both backends exist
    execMock.mockResolvedValueOnce({ code: 0, stdout: 'be-default', stderr: '' }); // describe be-default
    execMock.mockResolvedValueOnce({ code: 0, stdout: 'be-oauth-flow', stderr: '' }); // describe be-oauth-flow
    // Import succeeds
    execMock.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });
    // Second describe returns desired state
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump(desiredObj), stderr: '' });

    const res = await importUrlMap({ projectId: 'demo-project', env: 'dev', urlMapName: 'bitbrat-global-url-map', sourceYamlPath: urlMapFile, dryRun: false });
    expect(res.changed).toBe(true);
    expect(res.message).toMatch(/imported and verified/);

    // Verify import call occurred
    const calls = execMock.mock.calls.map((c) => c[1].join(' '));
    const importCall = calls.find((args) => /url-maps import/.test(args));
    expect(importCall).toBeTruthy();
  });

  it('skips import when referenced backend services are missing', async () => {
    // Force drift by making current empty
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump({}), stderr: '' });

    // Backend existence checks: be-default exists, be-oauth-flow missing
    // The rendered YAML contains default backend be-default and route to be-oauth-flow
    execMock.mockResolvedValueOnce({ code: 0, stdout: 'be-default', stderr: '' }); // describe be-default
    execMock.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'Not found' }); // describe be-oauth-flow

    const res = await importUrlMap({ projectId: 'demo-project', env: 'dev', urlMapName: 'bitbrat-global-url-map', sourceYamlPath: urlMapFile, dryRun: false });
    expect(res.changed).toBe(false);
    expect(res.message).toMatch(/Referenced backend services not found/);

    // Ensure no import attempt occurred
    const calls = execMock.mock.calls.map((c: any[]) => c[1].join(' '));
    const importCall = calls.find((args: string) => /url-maps import/.test(args));
    expect(importCall).toBeUndefined();
  });
});
