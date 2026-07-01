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

function writeServiceFile(repoRoot: string, name: string): void {
  const servicesDir = path.join(repoRoot, 'infrastructure', 'docker-compose', 'services');
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.writeFileSync(path.join(servicesDir, `${name}.compose.yaml`), `services:\n  ${name}: {}\n`, 'utf8');
}

function baseName(serviceFile: string): string {
  return path.basename(serviceFile, '.compose.yaml');
}

describe('ComposeFactory.getComposeFiles – honors active:false', () => {
  it('omits inactive per-service compose files on a full (--all) deploy', () => {
    const repoRoot = makeRepo('services: {}\n');
    ['llm-bot', 'obs-mcp', 'ingress-egress'].forEach((s) => writeServiceFile(repoRoot, s));

    const factory = new ComposeFactory(repoRoot);
    const { serviceFiles } = factory.getComposeFiles(undefined, ['obs-mcp']);
    const names = serviceFiles.map(baseName);

    expect(names).toEqual(['ingress-egress', 'llm-bot']);
    expect(names).not.toContain('obs-mcp');
  });

  it('includes all services when no inactive list is provided (down/logs/ps parity)', () => {
    const repoRoot = makeRepo('services: {}\n');
    ['llm-bot', 'obs-mcp'].forEach((s) => writeServiceFile(repoRoot, s));

    const factory = new ComposeFactory(repoRoot);
    const names = factory.getComposeFiles().serviceFiles.map(baseName);

    expect(names).toContain('obs-mcp');
    expect(names).toContain('llm-bot');
  });

  it('fails fast when an explicitly named target is inactive', () => {
    const repoRoot = makeRepo('services: {}\n');
    writeServiceFile(repoRoot, 'obs-mcp');

    const factory = new ComposeFactory(repoRoot);
    expect(() => factory.getComposeFiles('obs-mcp', ['obs-mcp'])).toThrow(/inactive/i);
  });

  it('still deploys an explicitly named active target', () => {
    const repoRoot = makeRepo('services: {}\n');
    ['llm-bot', 'obs-mcp'].forEach((s) => writeServiceFile(repoRoot, s));

    const factory = new ComposeFactory(repoRoot);
    const names = factory.getComposeFiles('llm-bot', ['obs-mcp']).serviceFiles.map(baseName);
    expect(names).toEqual(['llm-bot']);
  });
});

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
