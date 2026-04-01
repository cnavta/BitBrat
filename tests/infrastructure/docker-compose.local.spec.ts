import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

describe('docker-compose.local shared network configuration', () => {
  const composePath = path.resolve(process.cwd(), 'infrastructure/docker-compose/docker-compose.local.yaml');
  const compose = yaml.load(fs.readFileSync(composePath, 'utf8')) as any;

  it('treats bitbrat-network as an external shared network', () => {
    expect(compose.networks?.['bitbrat-network']).toMatchObject({
      external: true,
      name: 'bitbrat-network',
    });
  });

  it('attaches the local support services to bitbrat-network', () => {
    expect(compose.services?.nats?.networks?.['bitbrat-network']).toBeDefined();
    expect(compose.services?.['nats-box']?.networks?.['bitbrat-network']).toBeDefined();
    expect(compose.services?.['firebase-emulator']?.networks?.['bitbrat-network']).toBeDefined();
  });
});