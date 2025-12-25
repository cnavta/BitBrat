import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule, getModuleOutDir } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-net-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth network module', () => {
  it('generates terraform with VPC, subnets (for_each), routers (per region), firewalls, and outputs (no NAT)', () => {
    const tmp = mkTmpDir();
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), 'name: test\ndeploymentDefaults:\n  region: us-central1\n', 'utf8');
    const out = synthModule('network', { rootDir: tmp, env: 'dev', projectId: 'proj-123' });

    const expected = getModuleOutDir(tmp, 'network');
    expect(out).toBe(expected);
    const mainTf = fs.readFileSync(path.join(expected, 'main.tf'), 'utf8');

    expect(mainTf).toContain('module: network');
    expect(mainTf).toContain('google_compute_network');
    expect(mainTf).toContain('resource "google_compute_subnetwork" "subnet"');
    expect(mainTf).toContain('for_each                 = local.subnets');
    expect(mainTf).toContain('private_ip_google_access = true');
    expect(mainTf).toContain('resource "google_compute_router" "router"');
    expect(mainTf).toContain('for_each = toset(local.regions)');
    expect(mainTf).toContain('name     = "brat-router-${each.key}"');
    expect(mainTf).not.toContain('resource "google_compute_router_nat" "nat"');
    expect(mainTf).toContain('google_compute_firewall');
    expect(mainTf).toContain('brat-subnet-us-central1-dev');

    // sanity: firewall block syntax should use `allow`, not `allows`
    expect(mainTf).not.toContain('allows {');

    // outputs
    expect(mainTf).toContain('output "vpcSelfLink"');
    expect(mainTf).toContain('output "subnetSelfLinkByRegion"');
    expect(mainTf).toContain('output "routersByRegion"');
    expect(mainTf).not.toContain('output "natsByRegion"');

    // variable blocks must be multi-line (no single-line multiple arguments)
    expect(mainTf).toContain('variable "project_id" {');
    expect(mainTf).not.toContain('variable "project_id" { type = string');
    expect(mainTf).toContain('variable "region" {');
    expect(mainTf).not.toContain('variable "region" { type = string');
    expect(mainTf).toContain('variable "environment" {');
    expect(mainTf).not.toContain('variable "environment" { type = string');
  });

  it('honors overlays: multi-region subnets and flow logs enabled with optional remote backend', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\nnetwork:\n  regions: [us-central1, us-west1]\n  subnets:\n    us-central1: { cidr: 10.10.0.0/20 }\n    us-west1: { name: west-subnet, cidr: 10.20.0.0/20 }\n  enableFlowLogs: true\n  remoteState: { bucket: tf-state-bucket, prefix: network/dev }\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const out = synthModule('network', { rootDir: tmp, env: 'dev', projectId: 'proj-123' });
    const expected = getModuleOutDir(tmp, 'network');
    const mainTf = fs.readFileSync(path.join(expected, 'main.tf'), 'utf8');

    // backend block from remoteState (only if NOT in CI)
    const ci = String(process.env.CI || '').toLowerCase();
    if (ci !== 'true' && ci !== '1') {
      expect(mainTf).toContain('backend "gcs"');
      expect(mainTf).toContain('bucket = "tf-state-bucket"');
      expect(mainTf).toContain('prefix = "network/dev"');
    } else {
      expect(mainTf).not.toContain('backend "gcs"');
    }

    // regions locals and subnets map
    expect(mainTf).toContain('locals {');
    expect(mainTf).toContain('regions = ["us-central1", "us-west1"]');
    expect(mainTf).toContain('"us-west1" = { name = "west-subnet", cidr = "10.20.0.0/20" }');

    // flow logs block on subnetwork
    expect(mainTf).toContain('log_config');
    expect(mainTf).toContain('aggregation_interval = "INTERVAL_5_MIN"');
    expect(mainTf).toContain('flow_sampling        = 0.5');
    expect(mainTf).toContain('metadata             = "INCLUDE_ALL"');
  });
});
