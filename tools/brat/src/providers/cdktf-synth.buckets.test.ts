import fs from 'fs';
import os from 'os';
import path from 'path';
import { synthModule, getModuleOutDir } from './cdktf-synth';

function mkTmp(prefix = 'brat-cdktf-buckets-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('cdktf synth buckets module', () => {
  it('generates terraform for GCS buckets with policies, versioning, lifecycle, labels and outputs', () => {
    const tmp = mkTmp();
    const arch = `name: test
deploymentDefaults:
  region: us-central1
infrastructure:
  resources:
    assets:
      type: object-store
      implementation: cloud-storage
      access_policy: public
      location: us-east1
      lifecycle:
        rules:
          - action: Delete
            age: 30
    logs:
      type: object-store
      implementation: cloud-storage
      versioning: true
      labels:
        team: platform
`;
    fs.writeFileSync(path.join(tmp, 'architecture.yaml'), arch, 'utf8');

    const outDir = synthModule('buckets', { rootDir: tmp, env: 'dev', projectId: 'proj-123' });
    const expectedOut = getModuleOutDir(tmp, 'buckets');
    expect(outDir).toBe(expectedOut);

    const tf = fs.readFileSync(path.join(expectedOut, 'main.tf'), 'utf8');

    // Basic markers
    expect(tf).toContain('module: buckets');
    expect(tf).toContain('provider "google"');
    expect(tf).toContain('variable "project_id"');
    expect(tf).toContain('variable "region"');
    expect(tf).toContain('variable "environment"');

    // Buckets rendered
    expect(tf).toContain('resource "google_storage_bucket" "bucket_assets"');
    expect(tf).toContain('name     = "assets-dev"');
    expect(tf).toContain('location = "us-east1"');
    // Public bucket IAM configuration
    expect(tf).toContain('iam_configuration');
    expect(tf).toContain('uniform_bucket_level_access = true');
    expect(tf).toContain('resource "google_storage_bucket_iam_member" "public_assets"');
    expect(tf).toContain('member = "allUsers"');

    // Private bucket with versioning and labels merge
    expect(tf).toContain('resource "google_storage_bucket" "bucket_logs"');
    expect(tf).toContain('name     = "logs-dev"');
    expect(tf).toContain('versioning');
    // required labels and merged custom label
    expect(tf).toContain('"env"');
    expect(tf).toContain('"project"');
    expect(tf).toContain('"managed-by"');
    expect(tf).toContain('"team" = "platform"');

    // Lifecycle rule presence for assets
    expect(tf).toContain('lifecycle_rule');
    expect(tf).toContain('action');
    expect(tf).toContain('type = "Delete"');
    expect(tf).toContain('age = 30');

    // Validate outputs section deterministically without inline snapshots
    const outputsIdx = tf.indexOf('\n# Outputs\n');
    const outputs = outputsIdx >= 0 ? tf.substring(outputsIdx) : '';
    expect(outputs).toContain('output "bucketNames"');
    expect(outputs).toContain('["assets-dev", "logs-dev"]');
    expect(outputs).toContain('output "bucketUrlsByKey"');
    expect(outputs).toContain('"assets"');
    expect(outputs).toContain('gs://assets-dev');
    expect(outputs).toContain('https://storage.googleapis.com/assets-dev');
    expect(outputs).toContain('"logs"');
    expect(outputs).toContain('gs://logs-dev');
    expect(outputs).toContain('https://storage.googleapis.com/logs-dev');
  });
});
