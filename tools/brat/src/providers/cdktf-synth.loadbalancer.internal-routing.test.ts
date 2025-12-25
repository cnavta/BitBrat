import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-lb-internal-routing-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth load-balancer — internal routing rules', () => {
  it('generates host_rule and path_matcher for internal services', () => {
    const tmp = mkTmpDir();
    const arch = `name: test
deploymentDefaults:
  region: us-central1
services:
  auth: { active: true }
  llm-bot: { active: true }
infrastructure:
  target: gcp
  resources:
    internal-load-balancer:
      type: load-balancer
      implementation: regional-internal-application-lb
      name: bitbrat-internal-lb
      ip: bitbrat-internal-ip
      routing:
        default_domain: bitbrat.local
        rules:
          - path_prefix: /
            service: auth
          - path_prefix: /
            service: llm-bot
`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const outDir = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'p1' });
    const mainTf = fs.readFileSync(path.join(outDir, 'main.tf'), 'utf8');

    // Should have host rules
    expect(mainTf).toContain('host_rule {');
    expect(mainTf).toContain('hosts        = ["auth.bitbrat.local"]');
    expect(mainTf).toContain('path_matcher = "auth"');
    expect(mainTf).toContain('hosts        = ["llm-bot.bitbrat.local"]');
    expect(mainTf).toContain('path_matcher = "llm-bot"');

    // Should have path matchers
    expect(mainTf).toContain('path_matcher {');
    expect(mainTf).toContain('name            = "auth"');
    expect(mainTf).toContain('default_service = google_compute_region_backend_service.be-auth-internal.self_link');
    expect(mainTf).toContain('name            = "llm-bot"');
    expect(mainTf).toContain('default_service = google_compute_region_backend_service.be-llm-bot-internal.self_link');

    // Lifecycle should NOT ignore host_rule and path_matcher for internal LB
    expect(mainTf).toContain('resource "google_compute_region_url_map" "internal-load-balancer"');
    const lifecycleBlock = mainTf.split('resource "google_compute_region_url_map" "internal-load-balancer"')[1].split('}')[1]; // This is fragile, let's just check the string
    
    // Better check for ignore_changes
    expect(mainTf).not.toMatch(/resource "google_compute_region_url_map" "internal-load-balancer"[\s\S]*?ignore_changes = \[[^\]]*host_rule/);
  });
});
