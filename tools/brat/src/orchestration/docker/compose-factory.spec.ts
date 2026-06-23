import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComposeFactory } from './compose-factory';

function makeRepo(baseYaml: string): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-compose-'));
  const baseDir = path.join(repoRoot, 'infrastructure', 'docker-compose');
  fs.mkdirSync(path.join(baseDir, 'services'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'docker-compose.local.yaml'), baseYaml, 'utf8');
  return repoRoot;
}

describe('ComposeFactory.getBuildableBaseServices', () => {
  it('returns base-file services that declare a build section', () => {
    const repoRoot = makeRepo(`services:
  nats:
    image: nats:2-alpine
  firebase-emulator:
    build:
      context: .
      dockerfile: infrastructure/docker-compose/Dockerfile.emulator
`);
    const factory = new ComposeFactory(repoRoot);
    expect(factory.getBuildableBaseServices()).toEqual(['firebase-emulator']);
  });

  it('returns an empty array when no base service has a build section', () => {
    const repoRoot = makeRepo(`services:
  nats:
    image: nats:2-alpine
  ollama:
    image: ollama/ollama:latest
`);
    const factory = new ComposeFactory(repoRoot);
    expect(factory.getBuildableBaseServices()).toEqual([]);
  });

  it('returns an empty array when the base compose file is missing', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-compose-empty-'));
    const factory = new ComposeFactory(repoRoot);
    expect(factory.getBuildableBaseServices()).toEqual([]);
  });
});
