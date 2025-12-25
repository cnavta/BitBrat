import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule, getModuleOutDir } from './cdktf-synth';

function mkTmpDir(prefix = 'brat-cdktf-lb-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth load-balancer module', () => {
  it('generates terraform with IP, cert, proxy, forwarding rule, and outputs', () => {
    const tmp = mkTmpDir();
    const arch = `name: test\n
deploymentDefaults:\n  region: us-central1\n\ninfrastructure:\n  main-load-balancer:\n    routing:\n      default_domain: api.bitbrat.ai\n`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');
    const out = synthModule('load-balancer', { rootDir: tmp, env: 'dev', projectId: 'proj-123' });

    const expected = getModuleOutDir(tmp, 'load-balancer');
    expect(out).toBe(expected);
    const mainTf = fs.readFileSync(path.join(expected, 'main.tf'), 'utf8');

    expect(mainTf).toContain('module: load-balancer');

    // variables should be multi-line
    expect(mainTf).toContain('variable "project_id" {');
    expect(mainTf).not.toContain('variable "project_id" { type = string');
    expect(mainTf).toContain('variable "region" {');
    expect(mainTf).not.toContain('variable "region" { type = string');
    expect(mainTf).toContain('variable "environment" {');
    expect(mainTf).not.toContain('variable "environment" { type = string');

    // ensure use-existing for IP and cert via data sources
    expect(mainTf).toContain('data "google_compute_global_address" "frontend_ip"');
    expect(mainTf).toContain('name = "birtrat-ip"');

    expect(mainTf).toContain('data "google_compute_ssl_certificate" "managed_cert"');
    expect(mainTf).toContain('name = "bitbrat-dev-cert"');

    // no resource creations for IP/cert
    expect(mainTf).not.toContain('resource "google_compute_global_address" "frontend_ip"');
    expect(mainTf).not.toContain('resource "google_compute_managed_ssl_certificate" "managed_cert"');

    expect(mainTf).toContain('resource "google_compute_url_map" "main"');
    expect(mainTf).toContain('resource "google_compute_target_https_proxy" "https_proxy"');
    expect(mainTf).toContain('resource "google_compute_global_forwarding_rule" "https_rule"');

    // references should use data sources
    expect(mainTf).toContain('ssl_certificates = [data.google_compute_ssl_certificate.managed_cert.self_link]');
    expect(mainTf).toContain('ip_address            = data.google_compute_global_address.frontend_ip.address');

    // outputs
    expect(mainTf).toContain('output "lbIpAddresses"');
    expect(mainTf).toContain('output "urlMapName"');
    expect(mainTf).toContain('output "certificateResourceNames"');
    expect(mainTf).toContain('output "backendServiceNames"');
    expect(mainTf).toContain('google_compute_backend_service.be-default.name');
  });
});
