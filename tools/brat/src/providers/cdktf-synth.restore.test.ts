import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-restore-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth — restored infrastructure (sprint-168)', () => {
  it('network: includes proxy-only subnet and DNS zones', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
network:\n  regions: ["us-central1"]\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('network', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    expect(mainTf).toContain('resource "google_compute_subnetwork" "proxy_only_subnet"');
    expect(mainTf).toContain('purpose       = "REGIONAL_MANAGED_PROXY"');
    expect(mainTf).toContain('ip_cidr_range = "10.129.0.0/23"');
    expect(mainTf).toContain('resource "google_dns_managed_zone" "local_zone"');
    expect(mainTf).toContain('dns_name    = "bitbrat.local."');
    expect(mainTf).toContain('resource "google_dns_managed_zone" "internal_zone"');
    expect(mainTf).toContain('dns_name    = "bitbrat.internal."');
    expect(mainTf).toContain('output "internalDnsZoneName"');
    expect(mainTf).toContain('output "localDnsZoneName"');
  });

  it('load-balancer: includes internal LB resources when present in architecture', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
services:\n  llm-bot: { active: true }\n
infrastructure:\n  target: gcp\n  resources:\n    main-load-balancer:\n      type: load-balancer\n      implementation: global-external-application-lb\n      name: bitbrat-platform-lb\n      ip: bitbrat-platform-ip\n      routing:\n        default_domain: api.example.com\n        rules: []\n    internal-load-balancer:\n      type: load-balancer\n      implementation: regional-internal-application-lb\n      name: bitbrat-internal-lb\n      ip: bitbrat-internal-ip\n      routing:\n        default_domain: bitbrat.local\n        rules:\n          - path_prefix: /\n            service: llm-bot\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    expect(mainTf).toContain('resource "google_compute_address" "internal_load_balancer_ip"');
    expect(mainTf).toContain('resource "google_compute_region_backend_service" "be_llm_bot_internal"');
    expect(mainTf).toContain('load_balancing_scheme = "INTERNAL_MANAGED"');
    expect(mainTf).toContain('resource "google_compute_region_url_map" "internal_load_balancer"');
    expect(mainTf).toContain('resource "google_compute_region_target_http_proxy" "internal_load_balancer_proxy"');
    expect(mainTf).toContain('resource "google_compute_forwarding_rule" "internal_load_balancer_fr"');
    expect(mainTf).toContain('resource "google_dns_record_set" "internal_load_balancer_llm_bot_dns"');
    expect(mainTf).toContain('name         = "llm-bot.bitbrat.local."');
    expect(mainTf).toContain('managed_zone = "bitbrat-local"');
    expect(mainTf).toContain('output "lbIpAddresses"');
    expect(mainTf).toContain('google_compute_region_backend_service.be_llm_bot_internal.name');
    expect(mainTf).not.toContain('google_compute_backend_service.be_llm_bot_internal.name');
  });
});
