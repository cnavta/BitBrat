import fs from 'fs';
import path from 'path';
import { execCmd } from '../orchestration/exec';

export interface TerraformVars {
  project_id: string;
  region: string;
  service_name: string;
  repo_name: string;
  min_instances: number | string;
  max_instances: number | string;
  cpu: string;
  memory: string;
  port: number | string;
  allow_unauth: boolean | string;
  envJson: any;
  secrets: string[];
}

export interface TerraformOptions {
  cwd: string; // env dir
  vars: TerraformVars;
  dryRun?: boolean;
}

function writeAutoTfvars(tempDir: string, vars: TerraformVars): string {
  const file = path.join(tempDir, 'override.auto.tfvars.json');
  const content = JSON.stringify({ env: vars.envJson || {}, secrets: vars.secrets || [] }, null, 2);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

export async function terraformPlan(opts: TerraformOptions): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(process.cwd(), '.tfvars.'));
  const varFile = writeAutoTfvars(tmp, opts.vars);
  await execCmd('terraform', ['init', '-input=false', '-no-color'], { cwd: opts.cwd });
  await execCmd('terraform', ['validate', '-no-color'], { cwd: opts.cwd });
  const args = [
    'plan', '-input=false', '-lock=false', '-no-color',
    '-var', `project_id=${opts.vars.project_id}`,
    '-var', `region=${opts.vars.region}`,
    '-var', `service_name=${opts.vars.service_name}`,
    '-var', `repo_name=${opts.vars.repo_name}`,
    '-var', `min_instances=${opts.vars.min_instances}`,
    '-var', `max_instances=${opts.vars.max_instances}`,
    '-var', `cpu=${opts.vars.cpu}`,
    '-var', `memory=${opts.vars.memory}`,
    '-var', `port=${opts.vars.port}`,
    '-var', `allow_unauth=${opts.vars.allow_unauth}`,
    '-var-file', varFile,
    '-out', 'tfplan'
  ];
  const res = await execCmd('terraform', args, { cwd: opts.cwd });
  return res.code;
}

export async function terraformApply(opts: TerraformOptions): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(process.cwd(), '.tfvars.'));
  const varFile = writeAutoTfvars(tmp, opts.vars);
  await execCmd('terraform', ['init', '-input=false', '-no-color'], { cwd: opts.cwd });
  await execCmd('terraform', ['validate', '-no-color'], { cwd: opts.cwd });
  const args = [
    'apply', '-no-color', '-auto-approve',
    '-var', `project_id=${opts.vars.project_id}`,
    '-var', `region=${opts.vars.region}`,
    '-var', `service_name=${opts.vars.service_name}`,
    '-var', `repo_name=${opts.vars.repo_name}`,
    '-var', `min_instances=${opts.vars.min_instances}`,
    '-var', `max_instances=${opts.vars.max_instances}`,
    '-var', `cpu=${opts.vars.cpu}`,
    '-var', `memory=${opts.vars.memory}`,
    '-var', `port=${opts.vars.port}`,
    '-var', `allow_unauth=${opts.vars.allow_unauth}`,
    '-var-file', varFile,
  ];
  const res = await execCmd('terraform', args, { cwd: opts.cwd });
  return res.code;
}
