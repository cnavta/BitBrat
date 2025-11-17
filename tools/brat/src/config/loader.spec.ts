import path from 'path';
import { resolveConfig, synthesizeSecretMapping, filterEnvKvAgainstSecrets, loadArchitecture, listServices } from './loader';

describe('brat config loader', () => {
  const root = path.resolve(__dirname, '../../../../');

  it('synthesizes secret mapping correctly', () => {
    expect(synthesizeSecretMapping(['A', 'B'])).toBe('A=A:latest;B=B:latest');
    expect(synthesizeSecretMapping([])).toBe('');
  });

  it('filters env kv against secrets', () => {
    const envKv = 'FOO=1;BAR=2;BAZ=3';
    const secretMap = 'BAR=BAR:5;QUX=QUX:7';
    expect(filterEnvKvAgainstSecrets(envKv, secretMap)).toBe('FOO=1;BAZ=3');
  });

  it('loads architecture and lists known services', () => {
    const arch = loadArchitecture(root);
    const services = listServices(arch);
    expect(services.length).toBeGreaterThan(0);
    expect(services).toEqual(expect.arrayContaining(['oauth-flow']));
  });

  it('resolves services with defaults applied', () => {
    const cfg = resolveConfig(root);
    const oauth = cfg.services['oauth-flow'];
    expect(oauth).toBeDefined();
    expect(typeof oauth.port).toBe('number');
    expect(oauth.region).toBeTruthy();
  });
});
