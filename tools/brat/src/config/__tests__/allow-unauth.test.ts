import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveConfig } from '../loader';

function writeFile(dir: string, name: string, content: string) {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

describe('allowUnauthenticated mapping from architecture.yaml', () => {
  function baseYaml(extraSvc?: string) {
    return `
name: Test
defaults:
  services:
    region: us-central1
    security:
      allowUnauthenticated: true
services:
  svcA:
    active: true
    entry: src/index.ts
${extraSvc || ''}
`;
  }

  it('inherits defaults.security.allowUnauthenticated=true to services', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-allow-'));
    writeFile(dir, 'architecture.yaml', baseYaml());
    const cfg = resolveConfig(dir);
    expect(cfg.services['svcA'].allowUnauth).toBe(true);
  });

  it('service.security.allowUnauthenticated=false overrides defaults', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-allow-'));
    const arch = baseYaml('  svcB:\n    active: true\n    entry: src/other.ts\n    security:\n      allowUnauthenticated: false\n');
    writeFile(dir, 'architecture.yaml', arch);
    const cfg = resolveConfig(dir);
    expect(cfg.services['svcA'].allowUnauth).toBe(true);
    expect(cfg.services['svcB'].allowUnauth).toBe(false);
  });
});
