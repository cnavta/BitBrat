import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComposeFactory } from './compose-factory';

function makeRepo(baseYaml: string): { repoRoot: string; composePath: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-compose-'));
  const baseDir = path.join(repoRoot, 'infrastructure', 'docker-compose');
  fs.mkdirSync(path.join(baseDir, 'services'), { recursive: true });
  // Use non-context-specific name for testing per-service compose file logic
  // Context-specific names match pattern: docker-compose.{context}.yaml where context is [a-z-]+
  // Use docker-compose.yaml (no context suffix) to test per-service file behavior
  const composePath = 'infrastructure/docker-compose/docker-compose.yaml';
  fs.writeFileSync(path.join(repoRoot, composePath), baseYaml, 'utf8');
  return { repoRoot, composePath };
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
    const { repoRoot, composePath } = makeRepo('services: {}\n');
    ['llm-bot', 'obs-mcp', 'ingress-egress'].forEach((s) => writeServiceFile(repoRoot, s));

    const factory = new ComposeFactory(repoRoot, composePath);
    const { serviceFiles } = factory.getComposeFiles(undefined, ['obs-mcp']);
    const names = serviceFiles.map(baseName);

    expect(names).toEqual(['ingress-egress', 'llm-bot']);
    expect(names).not.toContain('obs-mcp');
  });

  it('includes all services when no inactive list is provided (down/logs/ps parity)', () => {
    const { repoRoot, composePath } = makeRepo('services: {}\n');
    ['llm-bot', 'obs-mcp'].forEach((s) => writeServiceFile(repoRoot, s));

    const factory = new ComposeFactory(repoRoot, composePath);
    const names = factory.getComposeFiles().serviceFiles.map(baseName);

    expect(names).toContain('obs-mcp');
    expect(names).toContain('llm-bot');
  });

  it('fails fast when an explicitly named target is inactive', () => {
    const { repoRoot, composePath } = makeRepo('services: {}\n');
    writeServiceFile(repoRoot, 'obs-mcp');

    const factory = new ComposeFactory(repoRoot, composePath);
    expect(() => factory.getComposeFiles('obs-mcp', ['obs-mcp'])).toThrow(/inactive/i);
  });

  it('still deploys an explicitly named active target', () => {
    const { repoRoot, composePath } = makeRepo('services: {}\n');
    ['llm-bot', 'obs-mcp'].forEach((s) => writeServiceFile(repoRoot, s));

    const factory = new ComposeFactory(repoRoot, composePath);
    const names = factory.getComposeFiles('llm-bot', ['obs-mcp']).serviceFiles.map(baseName);
    expect(names).toEqual(['llm-bot']);
  });
});

describe('ComposeFactory.getBuildableBaseServices', () => {
  it('returns base-file services that declare a build section', () => {
    const { repoRoot, composePath } = makeRepo(`services:
  nats:
    image: nats:2-alpine
  firebase-emulator:
    build:
      context: .
      dockerfile: infrastructure/docker-compose/Dockerfile.emulator
`);
    const factory = new ComposeFactory(repoRoot, composePath);
    expect(factory.getBuildableBaseServices()).toEqual(['firebase-emulator']);
  });

  it('returns an empty array when no base service has a build section', () => {
    const { repoRoot, composePath } = makeRepo(`services:
  nats:
    image: nats:2-alpine
  ollama:
    image: ollama/ollama:latest
`);
    const factory = new ComposeFactory(repoRoot, composePath);
    expect(factory.getBuildableBaseServices()).toEqual([]);
  });

  it('returns an empty array when the base compose file is missing', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-compose-empty-'));
    const composePath = 'infrastructure/docker-compose/docker-compose.missing.yaml';
    const factory = new ComposeFactory(repoRoot, composePath);
    expect(factory.getBuildableBaseServices()).toEqual([]);
  });
});
