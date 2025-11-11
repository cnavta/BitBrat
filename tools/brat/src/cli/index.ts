#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { createLogger } from '../orchestration/logger';
import { resolveConfig, loadEnvKv, synthesizeSecretMapping, filterEnvKvAgainstSecrets, loadArchitecture } from '../config/loader';
import { deriveTag } from '../util/git';
import { resolveSecretMappingToNumeric } from '../providers/gcp/secrets';
import { submitBuild } from '../providers/gcp/cloudbuild';
import { Queue } from '../orchestration/queue';
import { terraformApply, terraformPlan } from '../providers/terraform';
import { execCmd } from '../orchestration/exec';
import { ArchitectureSchema } from '../config/schema';
import { BratError, ConfigurationError, DependencyError, exitCodeForError } from '../orchestration/errors';

const RUN_ID = deriveTag();
const log = createLogger({ base: { runId: RUN_ID, component: 'brat' } });

interface GlobalFlags {
  projectId: string;
  region?: string;
  env: string;
  dryRun: boolean;
  concurrency?: number;
  json?: boolean;
}

function parseArgs(argv: string[]): { cmd: string[]; flags: GlobalFlags; rest: string[] } {
  const args = argv.slice(2);
  const flags: GlobalFlags = { projectId: process.env.PROJECT_ID || 'twitch-452523', env: process.env.BITBRAT_ENV || 'prod', dryRun: false } as any;
  const cmd: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project-id') { flags.projectId = String(args[++i]); }
    else if (a === '--region') { flags.region = String(args[++i]); }
    else if (a === '--env') { flags.env = String(args[++i]); }
    else if (a === '--dry-run') { flags.dryRun = true; }
    else if (a === '--concurrency') { flags.concurrency = Number(args[++i]); }
    else if (a === '--json') { flags.json = true; }
    else if (a.startsWith('-')) { rest.push(a); }
    else { cmd.push(a); }
  }
  return { cmd, flags, rest };
}

function printHelp() {
  console.log(`brat — BitBrat Rapid Administration Tool\n\nUsage:\n  brat doctor [--json]\n  brat config show [--json]\n  brat config validate [--json]\n  brat deploy services --all [--project-id <id>] [--region <r>] [--env <name>] [--dry-run] [--concurrency N]\n  brat infra plan [--env-dir <path>] [--service-name <svc>] [--repo-name <repo>] [--dry-run]\n  brat infra apply [--env-dir <path>] [--service-name <svc>] [--repo-name <repo>]\n`);
}

async function cmdDoctor(flags: GlobalFlags) {
  const checks: any = {};
  const nodeVersion = process.version;
  checks.node = { ok: true, version: nodeVersion };
  const probe = async (name: string, cmd: string, args: string[]) => {
    const res = await execCmd(cmd, args);
    const ok = res.code === 0;
    let version = '';
    if (ok) {
      const out = (res.stdout || res.stderr || '').trim();
      version = out.split('\n')[0];
    }
    checks[name] = { ok, version };
  };
  await Promise.all([
    probe('gcloud', 'gcloud', ['version']).catch(() => (checks.gcloud = { ok: false, version: '' })),
    probe('terraform', 'terraform', ['version']).catch(() => (checks.terraform = { ok: false, version: '' })),
    probe('docker', 'docker', ['--version']).catch(() => (checks.docker = { ok: false, version: '' })),
  ]);
  const ok = Object.values(checks).every((c: any) => c && c.ok);
  const result = { ok, checks };
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Doctor results:');
    for (const [k, v] of Object.entries<any>(checks)) {
      console.log(`- ${k}: ${v.ok ? 'OK' : 'MISSING'}${v.version ? ` (${v.version})` : ''}`);
    }
  }
  if (!ok) {
    process.exit(3);
  }
}

async function cmdConfigShow(flags: GlobalFlags) {
  const root = process.cwd();
  const cfg = resolveConfig(root);
  if (flags.json) {
    console.log(JSON.stringify(cfg, null, 2));
  } else {
    console.log(yaml.dump(cfg as any));
  }
}

async function cmdConfigValidate(flags: GlobalFlags) {
  const root = process.cwd();
  const archPath = path.join(root, 'architecture.yaml');
  const src = fs.readFileSync(archPath, 'utf8');
  const raw = yaml.load(src);
  const parsed = ArchitectureSchema.safeParse(raw);
  if (parsed.success) {
    const out = { valid: true };
    if (flags.json) console.log(JSON.stringify(out, null, 2)); else console.log('Config valid');
    return;
  }
  const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
  const out = { valid: false, issues };
  if (flags.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.error('Config invalid:');
    for (const i of issues) console.error(`- ${i.path}: ${i.message}`);
  }
  process.exit(2);
}

async function cmdDeployServices(flags: GlobalFlags) {
  const root = process.cwd();
  const cfg = resolveConfig(root);
  const services = Object.values(cfg.services);
  const concurrency = flags.concurrency || cfg.maxConcurrency || 1;
  const queue = new Queue(concurrency);
  const tag = deriveTag();

  const cbConfigPath = path.join(root, 'cloudbuild.oauth-flow.yaml');
  const repoName = 'bitbrat-services';

  if (!services.length) {
    throw new ConfigurationError('No services found in architecture.yaml');
  }

  const tasks = services.map((svc) => async () => {
    const serviceLog = log.child({ service: svc.name, action: 'deploy.service' });
    const start = Date.now();
    serviceLog.info({ status: 'start' }, 'Starting build+deploy');
    // Dockerfile inference
    let dockerfile = `Dockerfile.${svc.name}`;
    const kebab = svc.name.replace(/\s+/g, '-');
    if (!fs.existsSync(dockerfile)) {
      const alt = `Dockerfile.${kebab}`;
      if (fs.existsSync(alt)) dockerfile = alt; else {
        serviceLog.warn({ status: 'skipped', reason: 'dockerfile-not-found' }, 'Skipping service: Dockerfile not found');
        return { service: svc.name, skipped: true };
      }
    }
    // env and secrets
    const envKv = loadEnvKv(flags.env, svc.envKeys);
    let secretMap = synthesizeSecretMapping(svc.secrets);
    if (secretMap) {
      try {
        const resolved = await resolveSecretMappingToNumeric(secretMap, flags.projectId);
        if (resolved) secretMap = resolved; // resolved to numeric
      } catch (e: any) {
        if (!flags.dryRun) {
          throw new DependencyError(e?.message || String(e));
        } else {
          serviceLog.warn({ status: 'dry-run', reason: 'missing-secret-versions', error: e?.message || String(e) }, 'DRY-RUN: would fail due to missing secret versions');
        }
      }
    }
    const envFiltered = filterEnvKvAgainstSecrets(envKv, secretMap);

    const substitutions: Record<string, string | number | boolean> = {
      _SERVICE_NAME: svc.name,
      _REGION: flags.region || svc.region,
      _REPO_NAME: repoName,
      _DRY_RUN: false,
      _TAG: tag,
      _PORT: svc.port,
      _MIN_INSTANCES: svc.minInstances,
      _MAX_INSTANCES: svc.maxInstances,
      _CPU: svc.cpu,
      _MEMORY: svc.memory,
      _ALLOW_UNAUTH: svc.allowUnauth,
      _SECRET_SET_ARG: secretMap || '',
      _ENV_VARS_ARG: envFiltered || '',
      _DOCKERFILE: dockerfile,
    };

    if (flags.dryRun) {
      serviceLog.info({ status: 'dry-run', substitutions }, 'DRY-RUN: Would submit Cloud Build');
      return { service: svc.name, dryRun: true };
    }
    const res = await submitBuild({
      projectId: flags.projectId,
      configPath: cbConfigPath,
      substitutions,
      cwd: root,
      dryRun: false,
      onStdout: (chunk) => {
        // Split lines and log each with context to avoid giant buffered dump
        chunk.split(/\r?\n/).filter(Boolean).forEach((line) => serviceLog.info({ stream: 'stdout' }, line));
      },
      onStderr: (chunk) => {
        chunk.split(/\r?\n/).filter(Boolean).forEach((line) => serviceLog.warn({ stream: 'stderr' }, line));
      },
    });
    const durationMs = Date.now() - start;
    if (res.code !== 0) {
      serviceLog.error({ status: 'failed', code: res.code, durationMs }, 'Cloud Build failed');
      throw new DependencyError(`Cloud Build failed for ${svc.name}: ${res.stderr || res.stdout}`);
    }
    serviceLog.info({ status: 'success', durationMs }, 'Build+deploy finished');
    return { service: svc.name, ok: true };
  });

  const results = await Promise.all(tasks.map((t) => queue.add(t)));
  const failed = results.filter((r: any) => r && r.ok === false);
  if (failed.length) {
    process.exit(1);
  }
  log.info({ action: 'deploy.services.complete' }, 'deploy services completed');
}

async function cmdInfra(action: 'plan' | 'apply', flags: GlobalFlags, envDir: string, serviceName: string, repoName: string) {
  const root = process.cwd();
  const cfg = resolveConfig(root);
  const svc = cfg.services[serviceName] || Object.values(cfg.services)[0];
  if (!svc) {
    console.error('No services found to supply ports and scaling vars.');
    process.exit(2);
  }
  const envJsonStr = (() => {
    // Reuse loader to get JSON
    const script = path.join(process.cwd(), 'infrastructure/scripts/load-env.js');
    const { spawnSync } = require('child_process');
    const res = spawnSync('node', [script, '--env', flags.env, '--format', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const out = res.stdout?.toString?.() || '{}';
    return JSON.parse(out);
  })();

  const secrets = svc.secrets || [];

  const vars = {
    project_id: flags.projectId,
    region: flags.region || svc.region,
    service_name: serviceName || svc.name,
    repo_name: repoName,
    min_instances: svc.minInstances,
    max_instances: svc.maxInstances,
    cpu: svc.cpu,
    memory: svc.memory,
    port: svc.port,
    allow_unauth: svc.allowUnauth,
    envJson: envJsonStr,
    secrets,
  };

  if (action === 'plan' || flags.dryRun) {
    await terraformPlan({ cwd: envDir, vars });
  } else {
    await terraformApply({ cwd: envDir, vars });
  }
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv);
  if (cmd.length === 0) { printHelp(); return; }
  const [c1, c2] = cmd;
  if (c1 === 'doctor') {
    await cmdDoctor(flags);
    return;
  }
  if (c1 === 'config' && c2 === 'show') {
    await cmdConfigShow(flags);
    return;
  }
  if (c1 === 'config' && c2 === 'validate') {
    await cmdConfigValidate(flags);
    return;
  }
  if (c1 === 'deploy' && c2 === 'services') {
    await cmdDeployServices(flags);
    return;
  }
  if (c1 === 'infra' && (c2 === 'plan' || c2 === 'apply')) {
    // defaults per bash script
    const envDir = process.env.ENV_DIR || path.join('infrastructure', 'gcp', 'prod');
    const serviceName = process.env.SERVICE_NAME || 'oauth-flow';
    const repoName = process.env.REPO_NAME || 'bitbrat-services';
    await cmdInfra(c2 as any, flags, envDir, serviceName, repoName);
    return;
  }
  printHelp();
}

main().catch((err) => {
  const code = exitCodeForError(err);
  log.error({ err, code }, 'brat failed');
  process.exit(code);
});
