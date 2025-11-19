import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-lb-routing-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth load-balancer — routing-driven backends/assets-proxy', () => {
  it('service-only routing: only active referenced services produce NEGs/backends; no assets-proxy', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
services:\n  oauth-flow: { active: true }\n  ingress-egress: { active: true }\n  auth: { active: false }\n
infrastructure:\n  target: gcp\n  resources:\n    main-load-balancer:\n      type: load-balancer\n      implementation: global-external-application-lb\n      name: bitbrat-platform-lb\n      ip: bitbrat-platform-ip\n      routing:\n        default_domain: api.example.com\n        rules:\n          - path_prefix: /oauth\n            service: oauth-flow\n          - path_prefix: /_debug/ingress/twitch\n            rewrite_prefix: /_debug/twitch\n            service: ingress-egress\n          - path_prefix: /auth\n            service: auth\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    // Active referenced services
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-oauth-flow"');
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-ingress-egress"');
    // NEGs per default region for services
    expect(mainTf).toContain('resource "google_compute_region_network_endpoint_group" "neg-oauth-flow-us-central1"');
    expect(mainTf).toContain('resource "google_compute_region_network_endpoint_group" "neg-ingress-egress-us-central1"');
    // Inactive referenced service must not produce resources
    expect(mainTf).not.toContain('be-auth');
    expect(mainTf).not.toContain('neg-auth-');
    // No assets-proxy in service-only routing
    expect(mainTf).not.toContain('be-assets-proxy');
    expect(mainTf).not.toContain('neg-assets-proxy-');
    // Outputs include backendServiceNames and negNames
    expect(mainTf).toContain('output "backendServiceNames"');
    expect(mainTf).toContain('output "negNames"');
  });

  it('bucket-only routing: synthesizes assets-proxy NEGs/backend; no service backends; default backend be-default', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
services:\n  oauth-flow: { active: true }\n
infrastructure:\n  target: gcp\n  resources:\n    default-content-bucket:\n      type: object-store\n      implementation: cloud-storage\n    main-load-balancer:\n      type: load-balancer\n      implementation: global-external-application-lb\n      name: bitbrat-platform-lb\n      ip: bitbrat-platform-ip\n      routing:\n        default_domain: api.example.com\n        default_bucket: default-content-bucket\n        rules:\n          - path_prefix: /assets\n            bucket: default-content-bucket\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    expect(mainTf).toContain('resource "google_compute_backend_service" "be-assets-proxy"');
    expect(mainTf).toContain('resource "google_compute_region_network_endpoint_group" "neg-assets-proxy-us-central1"');
    // No service backends since no service rules
    expect(mainTf).not.toContain('resource "google_compute_backend_service" "be-oauth-flow"');
    // Default backend falls back to be-default
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-default"');
    expect(mainTf).toContain('default_service = google_compute_backend_service.be-default.self_link');
  });

  it('mixed routing: includes service backends and assets-proxy; default backend is first referenced service', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
services:\n  oauth-flow: { active: true }\n  ingress-egress: { active: true }\n
infrastructure:\n  target: gcp\n  resources:\n    default-content-bucket:\n      type: object-store\n      implementation: cloud-storage\n    main-load-balancer:\n      type: load-balancer\n      implementation: global-external-application-lb\n      name: bitbrat-platform-lb\n      ip: bitbrat-platform-ip\n      routing:\n        default_domain: api.example.com\n        rules:\n          - path_prefix: /_debug/ingress/twitch\n            service: ingress-egress\n          - path_prefix: /assets\n            bucket: default-content-bucket\n          - path_prefix: /oauth\n            service: oauth-flow\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    // Service backends present
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-ingress-egress"');
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-oauth-flow"');
    // Assets proxy present due to bucket routing
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-assets-proxy"');
    // Default backend should be first referenced service (ingress-egress)
    expect(mainTf).toContain('default_service = google_compute_backend_service.be-ingress-egress.self_link');
  });
});
