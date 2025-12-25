import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule, getModuleOutDir } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-lb2-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth load-balancer — services/NEGs/backends and mode behavior', () => {
  it('creates per-service NEGs and a backend aggregating them; exposes outputs', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
lb:\n  ipMode: create\n  ipName: my-dev-ip\n  certMode: managed\n  services:\n    - name: api\n      regions: [us-central1, us-east1]\n      runService: { name: api-svc }\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    // NEGs per region
    expect(mainTf).toContain('resource "google_compute_region_network_endpoint_group" "neg-api-svc-us-central1"');
    expect(mainTf).toContain('resource "google_compute_region_network_endpoint_group" "neg-api-svc-us-east1"');
    // Backend per service with two backend attachments
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-api"');
    expect(mainTf.match(/backend \{/g)?.length).toBeGreaterThanOrEqual(2);
    // Outputs include names
    expect(mainTf).toContain('output "backendServiceNames"');
    expect(mainTf).toContain('google_compute_backend_service.be-api.name');
    expect(mainTf).toContain('output "negNames"');
    expect(mainTf).toContain('google_compute_region_network_endpoint_group.neg-api-svc-us-central1.name');
    expect(mainTf).toContain('google_compute_region_network_endpoint_group.neg-api-svc-us-east1.name');
    // Dev create path: IP resource and managed cert resource
    expect(mainTf).toContain('resource "google_compute_global_address" "frontend_ip"');
    expect(mainTf).toContain('resource "google_compute_managed_ssl_certificate" "managed_cert"');
  });

  it('prod defaults to data lookups for IP and cert when use-existing', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
lb:\n  ipMode: use-existing\n  ipName: prod-global-ip\n  certMode: use-existing\n  certRef: projects/p/global/sslCertificates/acme-cert\n  services: []\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'prod', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    expect(mainTf).toContain('data "google_compute_global_address" "frontend_ip"');
    expect(mainTf).toContain('name = "prod-global-ip"');
    expect(mainTf).toContain('data "google_compute_ssl_certificate" "managed_cert"');
    expect(mainTf).toContain('acme-cert');
    // No creations for IP/cert in this mode
    expect(mainTf).not.toContain('resource "google_compute_global_address" "frontend_ip"');
    expect(mainTf).not.toContain('resource "google_compute_managed_ssl_certificate" "managed_cert"');
  });

  it('snapshot — dev overlay (create IP + managed cert + services)', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
lb:\n  ipMode: create\n  ipName: dev-ip\n  certMode: managed\n  services:\n    - name: web\n      regions: [us-central1]\n      runService: { name: web-svc }\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p-dev' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');
    expect(mainTf).toMatchSnapshot();
  });

  it('snapshot — prod overlay (use-existing IP/Cert; no services)', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
lb:\n  ipMode: use-existing\n  ipName: prod-global-ip\n  certMode: use-existing\n  certRef: projects/p/global/sslCertificates/prod-cert\n  services: []\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'prod', projectId: 'p-prod' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');
    expect(mainTf).toMatchSnapshot();
  });
});
