import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule, getModuleOutDir } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-conn-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth connectors module', () => {
  it('generates terraform for vpc access connector and outputs', () => {
    const tmp = mkTmpDir();
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), 'name: test\ndeploymentDefaults:\n  region: us-central1\n', 'utf8');
    const out = synthModule('connectors', { rootDir: tmp, env: 'dev', projectId: 'proj-123' });

    const expected = getModuleOutDir(tmp, 'connectors');
    expect(out).toBe(expected);
    const mainTf = fs.readFileSync(path.join(expected, 'main.tf'), 'utf8');

    expect(mainTf).toContain('module: connectors');

    // variables should be multi-line
    expect(mainTf).toContain('variable "project_id" {');
    expect(mainTf).toContain('variable "region" {');
    expect(mainTf).toContain('variable "environment" {');

    // data sources and resource
    expect(mainTf).toContain('data "google_compute_network" "vpc"');
    expect(mainTf).toContain('resource "google_vpc_access_connector" "connector"');

    // naming conventions
    expect(mainTf).toContain('brat-conn-us-central1-dev');

    // ensure connector uses network + ip_cidr_range (no subnet block)
    expect(mainTf).toContain('network        = data.google_compute_network.vpc.name');
    expect(mainTf).toContain('ip_cidr_range  = "10.8.0.0/28"');
    expect(mainTf).toContain('max_instances  = 3');
    expect(mainTf).toContain('min_instances  = 2');
    expect(mainTf).not.toContain('data "google_compute_subnetwork" "subnet"');
    expect(mainTf).not.toContain('subnet {');

    // outputs
    expect(mainTf).toContain('output "connectorsByRegion"');
  });
});
