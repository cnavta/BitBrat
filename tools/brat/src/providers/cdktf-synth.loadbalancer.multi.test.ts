import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-lb-multi-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth load-balancer — multiple LBs and resource sharing', () => {
  it('shares backend services between multiple LBs; unique names for internal LBs', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n
services:\n  api: { active: true }\n
infrastructure:\n  target: gcp\n  resources:\n    main-load-balancer:\n      type: load-balancer\n      implementation: global-external-application-lb\n      name: bitbrat-platform-lb\n      ip: bitbrat-platform-ip\n      routing:\n        default_domain: api.example.com\n        rules:\n          - path_prefix: /\n            service: api\n    internal-load-balancer:\n      type: load-balancer\n      implementation: regional-internal-application-lb\n      name: bitbrat-internal-lb\n      ip: bitbrat-internal-ip\n      routing:\n        default_domain: bitbrat.local\n        rules:\n          - path_prefix: /\n            service: api\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    // External backend service for 'api'
    expect(mainTf).toContain('resource "google_compute_backend_service" "be-api"');
    // Internal regional backend service for 'api'
    expect(mainTf).toContain('resource "google_compute_region_backend_service" "be-api-internal"');
    
    // Ensure only ONE definition of each
    expect(mainTf.match(/resource "google_compute_backend_service" "be-api"/g)?.length).toBe(1);
    expect(mainTf.match(/resource "google_compute_region_backend_service" "be-api-internal"/g)?.length).toBe(1);

    // Main LB uses legacy names
    expect(mainTf).toContain('resource "google_compute_url_map" "main"');
    expect(mainTf).toContain('resource "google_compute_global_forwarding_rule" "https_rule"');
    
    // Internal LB uses unique names
    expect(mainTf).toContain('resource "google_compute_region_url_map" "internal-load-balancer"');
    expect(mainTf).toContain('resource "google_compute_forwarding_rule" "internal-load-balancer_fr"');
  });
});
