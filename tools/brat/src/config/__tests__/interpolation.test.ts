import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadArchitecture } from '../loader';

function writeArch(tmpDir: string, yamlContent: string) {
  fs.writeFileSync(path.join(tmpDir, 'architecture.yaml'), yamlContent, 'utf8');
}

describe('config interpolation', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.BITBRAT_INTERPOLATION = '1';
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  function baseYaml(extra: string) {
    return `
name: Test
defaults:
  services:
    region: us-central1
services:
  svc:
    active: true
    entry: src/index.ts
infrastructure:
  target: gcp
  resources:
    lb:
      type: load-balancer
      implementation: global-external-application-lb
      name: test
      ip: test-ip
      routing:
        default_domain: api.bitbrat.ai
        rules: []
${extra}
deploymentDefaults:
  region: us-central1
`;
  }

  it('substitutes ${ENV_PREFIX} and ${DOMAIN_SUFFIX:-default}', () => {
    process.env.BITBRAT_ENV = 'dev';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-arch-'));
    const y = baseYaml(``)
      .replace('api.bitbrat.ai', 'api.${ENV_PREFIX}${DOMAIN_SUFFIX:-bitbrat.ai}');
    writeArch(tmp, y);
    const arch = loadArchitecture(tmp);
    const dd = (arch as any).infrastructure.resources.lb.routing.default_domain;
    expect(dd).toBe('api.dev.bitbrat.ai');
  });

  it('ENV_PREFIX empty for prod', () => {
    process.env.BITBRAT_ENV = 'prod';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-arch-'));
    const y = baseYaml(``)
      .replace('api.bitbrat.ai', 'api.${ENV_PREFIX}${DOMAIN_SUFFIX:-bitbrat.ai}');
    writeArch(tmp, y);
    const arch = loadArchitecture(tmp);
    const dd = (arch as any).infrastructure.resources.lb.routing.default_domain;
    expect(dd).toBe('api.bitbrat.ai');
  });

  it('applies default fallback and transform pipes', () => {
    process.env.BITBRAT_ENV = 'dev';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-arch-'));
    const extra = `
    bucket:
      type: object-store
      implementation: cloud-storage
      description: "level=${'${ENV|upper}'} missing=${'${NOPE:-fallback}'} dollars=$$100"
`;
    writeArch(tmp, baseYaml(extra));
    const arch = loadArchitecture(tmp) as any;
    const desc: string = arch.infrastructure.resources.bucket.description;
    expect(desc).toContain('level=DEV');
    expect(desc).toContain('missing=fallback');
    expect(desc).toContain('dollars=$100');
  });

  it('leaves unknown vars unresolved in non-critical fields', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-arch-'));
    const extra = `
    bucket:
      type: object-store
      implementation: cloud-storage
      description: "value=${'${UNKNOWN_VAR}'}"
`;
    writeArch(tmp, baseYaml(extra));
    const arch = loadArchitecture(tmp) as any;
    const desc: string = arch.infrastructure.resources.bucket.description;
    expect(desc).toBe('value=${UNKNOWN_VAR}');
  });

  it('throws when unresolved var remains in critical default_domain', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-arch-'));
    const y = baseYaml('')
      .replace('api.bitbrat.ai', 'api.${SOMETHING}.bitbrat.ai');
    writeArch(tmp, y);
    expect(() => loadArchitecture(tmp)).toThrow(/Unresolved interpolation.*default_domain/);
  });
});
