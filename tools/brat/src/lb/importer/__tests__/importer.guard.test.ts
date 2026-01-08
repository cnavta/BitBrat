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

function makeRendererInputBucket(): RendererInput {
  return {
    name: 'bitbrat-global-url-map',
    projectId: 'demo-project',
    env: 'dev',
    defaultDomain: 'api.bitbrat.ai',
    routes: [
      { pathPrefix: '/assets', bucket: 'site-assets' },
    ],
    defaultBackend: 'be-assets-proxy',
  };
}

describe('Importer guard — includes be-assets-proxy when bucket routes present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-import-guard-'));
  const urlMapFile = path.join(tmpDir, 'url-map.yaml');
  const desiredObj = renderUrlMapYaml(makeRendererInputBucket());
  writeYamlFile(desiredObj, urlMapFile);

  beforeEach(() => {
    execMock.mockReset();
  });

  it('skips import when be-assets-proxy backend is missing in non-prod', async () => {
    // Drift exists (empty current)
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump({}), stderr: '' });
    // Backend existence checks: default be-assets-proxy (due to default) referenced via defaultService and in route
    execMock.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'Not found' }); // describe be-assets-proxy

    const res = await importUrlMap({ projectId: 'demo-project', env: 'dev', urlMapName: 'bitbrat-global-url-map', sourceYamlPath: urlMapFile });
    expect(res.changed).toBe(false);
    expect(res.message).toMatch(/Referenced backend services not found/);
    const calls = execMock.mock.calls.map((c: any[]) => c[1].join(' '));
    expect(calls.join('\n')).not.toMatch(/url-maps import/);
  });

  it('imports when be-assets-proxy exists in non-prod', async () => {
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump({}), stderr: '' }); // describe url-map (empty)
    execMock.mockResolvedValueOnce({ code: 0, stdout: 'be-assets-proxy', stderr: '' }); // describe be-assets-proxy
    execMock.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }); // import
    execMock.mockResolvedValueOnce({ code: 0, stdout: yaml.dump(desiredObj), stderr: '' }); // describe after

    const res = await importUrlMap({ projectId: 'demo-project', env: 'dev', urlMapName: 'bitbrat-global-url-map', sourceYamlPath: urlMapFile });
    expect(res.changed).toBe(true);
    expect(res.message).toMatch(/imported and verified/);
  });
});
