import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule, getModuleOutDir } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth scaffold', () => {
  it('generates minimal terraform project for network module', () => {
    const tmp = mkTmpDir();
    // minimal architecture.yaml to satisfy loader if invoked
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), 'name: test\nservices: {}\n', 'utf8');

    const out = synthModule('network', { rootDir: tmp });

    const expectedOut = getModuleOutDir(tmp, 'network');
    expect(out).toBe(expectedOut);
    expect(fs.existsSync(expectedOut)).toBe(true);
    const mainTf = path.join(expectedOut, 'main.tf');
    const readme = path.join(expectedOut, 'README.md');
    expect(fs.existsSync(mainTf)).toBe(true);
    expect(fs.existsSync(readme)).toBe(true);

    const mainContents = fs.readFileSync(mainTf, 'utf8');
    expect(mainContents).toContain('module: network');
    // Stability: synth twice yields identical content
    const before = fs.readFileSync(mainTf, 'utf8');
    const out2 = synthModule('network', { rootDir: tmp });
    const after = fs.readFileSync(path.join(out2, 'main.tf'), 'utf8');
    expect(after).toEqual(before);
  });

  it('generates minimal terraform project for load-balancer module', () => {
    const tmp = mkTmpDir();
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), 'name: test\nservices: {}\n', 'utf8');

    const out = synthModule('load-balancer', { rootDir: tmp });

    const expectedOut = getModuleOutDir(tmp, 'load-balancer');
    expect(out).toBe(expectedOut);
    expect(fs.existsSync(expectedOut)).toBe(true);
    const mainTf = path.join(expectedOut, 'main.tf');
    const readme = path.join(expectedOut, 'README.md');
    expect(fs.existsSync(mainTf)).toBe(true);
    expect(fs.existsSync(readme)).toBe(true);

    const mainContents = fs.readFileSync(mainTf, 'utf8');
    expect(mainContents).toContain('module: load-balancer');
  });
});
