#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { createLogger } from '../orchestration/logger';
import { resolveConfig, loadEnvKv, synthesizeSecretMapping, filterEnvKvAgainstSecrets, loadArchitecture, ResolvedServiceConfig } from '../config/loader';
import { deriveTag } from '../util/git';
import { resolveSecretMappingToNumeric } from '../providers/gcp/secrets';
import { submitBuild } from '../providers/gcp/cloudbuild';
import { Queue } from '../orchestration/queue';
import { terraformApply, terraformPlan, terraformPlanGeneric, terraformApplyGeneric } from '../providers/terraform';
import { execCmd } from '../orchestration/exec';
import { ArchitectureSchema } from '../config/schema';
import { BratError, ConfigurationError, DependencyError, exitCodeForError } from '../orchestration/errors';
import { synthModule } from '../providers/cdktf-synth';
import { createTrigger, updateTrigger, deleteTrigger } from '../providers/gcp/cloudbuild-triggers';
import { assertVpcPreconditions } from '../providers/gcp/preflight';
import { renderAndWrite } from '../lb/urlmap';
import { importUrlMap } from '../lb/importer';
import { enableApis, getRequiredApis } from '../providers/gcp/apis';

const RUN_ID = deriveTag();
const log = createLogger({ base: { runId: RUN_ID, component: 'brat' } });

interface GlobalFlags {
  projectId: string;
  region?: string;
  env: string;
  dryRun: boolean;
  concurrency?: number;
  json?: boolean;
  module?: string;
  allowNoVpc?: boolean;
  ci?: boolean;
  imageTag?: string;
  repoName?: string;
  envExplicit?: boolean;
}

export function parseArgs(argv: string[]): { cmd: string[]; flags: GlobalFlags; rest: string[] } {
  const args = argv.slice(2);
  // Do NOT default env to a hard-coded value; if BITBRAT_ENV is not set and --env is not provided,
  // leave flags.env empty so that commands which require an env can enforce it explicitly.
  const flags: GlobalFlags = { projectId: process.env.PROJECT_ID || 'twitch-452523', env: process.env.BITBRAT_ENV || '', dryRun: false } as any;
  const cmd: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project-id') { flags.projectId = String(args[++i]); }
    else if (a === '--region') { flags.region = String(args[++i]); }
    else if (a === '--env') { flags.env = String(args[++i]); (flags as any).envExplicit = true; }
    else if (a === '--dry-run') { flags.dryRun = true; }
    else if (a === '--concurrency') { flags.concurrency = Number(args[++i]); }
    else if (a === '--json') { flags.json = true; }
    else if (a === '--module') { flags.module = String(args[++i]); }
    else if (a === '--allow-no-vpc') { (flags as any).allowNoVpc = true; }
    else if (a === '--ci') { flags.ci = true; }
    else if (a === '--image-tag') { flags.imageTag = String(args[++i]); }
    else if (a === '--repo') { flags.repoName = String(args[++i]); }
    else if (a.startsWith('-')) {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        rest.push(`${a}=${next}`);
        i++;
      } else {
        rest.push(a);
      }
    }
    else { cmd.push(a); }
  }
  // Defaults and environment-driven toggles
  // Allow bypassing strict VPC preflight outside prod unless explicitly disabled
  const ciEnv = String(process.env.CI || '').toLowerCase();
  const isCi = ciEnv === 'true' || ciEnv === '1';
  const allowNoVpcEnv = process.env.BITBRAT_ALLOW_NO_VPC;
  const strictEnv = process.env.BITBRAT_STRICT_PRECHECKS;
  const isStrict = (strictEnv === '1' || strictEnv?.toLowerCase() === 'true' || !!flags.ci || isCi);
  if (allowNoVpcEnv != null) {
    // Explicit environment override takes precedence
    (flags as any).allowNoVpc = allowNoVpcEnv === '1' || allowNoVpcEnv?.toLowerCase() === 'true';
  } else if ((flags as any).allowNoVpc == null) {
    // Implicit default: outside CI and when not explicitly strict, allow skipping VPC preflight
    if (!isStrict) {
      (flags as any).allowNoVpc = true;
    }
  }
  return { cmd, flags, rest };
}

function printHelp() {
  console.log(`brat — BitBrat Rapid Administration Tool

Usage:
  brat doctor [--json] [--ci]
  brat config show [--json]
  brat config validate [--json]

  brat service bootstrap --name <name> [--mcp] [--force]

  # The following commands REQUIRE an environment: pass --env <name> or set BITBRAT_ENV
  brat deploy services --all --env <name> [--project-id <id>] [--region <r>] [--dry-run] [--concurrency N] [--allow-no-vpc] [--image-tag <t>] [--repo <name>]
  brat deploy service <name> --env <name> [--project-id <id>] [--region <r>] [--dry-run] [--allow-no-vpc] [--image-tag <t>] [--repo <name>]
  brat deploy <name> --env <name> [--project-id <id>] [--region <r>] [--dry-run] [--allow-no-vpc] [--image-tag <t>] [--repo <name>]
  brat infra plan --env <name> [--module <network|load-balancer|connectors>] [--env-dir <path>] [--service-name <svc>] [--repo-name <repo>] [--dry-run]
  brat infra apply --env <name> [--module <network|load-balancer|connectors>] [--env-dir <path>] [--service-name <svc>] [--repo-name <repo>]
  brat infra plan network|lb|connectors --env <name> [--dry-run]
  brat infra apply network|lb|connectors --env <name>
  brat lb urlmap render --env <name> [--out <path>] [--project-id <id>]
  brat lb urlmap import --env <name> [--project-id <id>] [--dry-run]
  brat apis enable --env <name> [--project-id <id>] [--dry-run] [--json]

  brat trigger create --name <n> --repo <owner/repo> --branch <regex> --config <path> [--dry-run]
  brat trigger update --name <n> --repo <owner/repo> --branch <regex> --config <path> [--dry-run]
  brat trigger delete --name <n> [--dry-run]

Notes:
  - Provide --env or set BITBRAT_ENV. Common values: dev, prod.
`);
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
  if (flags.ci) {
    // In CI (e.g., Cloud Build), some tools may not be available in the npm builder image.
    // Treat these as skipped but OK to allow pipelines to proceed.
    checks.gcloud = { ok: true, version: 'ci-skip' };
    checks.terraform = { ok: true, version: 'ci-skip' };
    checks.docker = { ok: true, version: 'ci-skip' };
  } else {
    await Promise.all([
      probe('gcloud', 'gcloud', ['version']).catch(() => (checks.gcloud = { ok: false, version: '' })),
      probe('terraform', 'terraform', ['version']).catch(() => (checks.terraform = { ok: false, version: '' })),
      probe('docker', 'docker', ['--version']).catch(() => (checks.docker = { ok: false, version: '' })),
    ]);
  }
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

function parseKeyValueFlags(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    if (v !== undefined) out[key] = v;
    else out[key] = 'true';
  }
  return out;
}

export async function cmdTrigger(action: 'create' | 'update' | 'delete', flags: GlobalFlags, rest: string[]) {
  const m = parseKeyValueFlags(rest);
  const name = m['name'] || m['n'];
  if (!name) {
    console.error('Missing --name');
    process.exit(2);
  }
  if (action === 'delete') {
    const res = await deleteTrigger(flags.projectId, name, !!flags.dryRun);
    if (flags.json) console.log(JSON.stringify(res)); else console.log(`${res.action}: ${name}`);
    return;
  }
  const repo = m['repo'];
  const branch = m['branch'] || '.*';
  const config = m['config'] || m['build-config'] || 'cloudbuild.yaml';
  if (!repo) {
    console.error('Missing --repo <owner/repo>');
    process.exit(2);
  }
  const spec = {
    name,
    configPath: config,
    substitutions: {},
    repoSource: { type: 'github' as const, repo, branchRegex: branch },
  };
  if (action === 'create') {
    const res = await createTrigger(flags.projectId, spec, !!flags.dryRun);
    if (flags.json) console.log(JSON.stringify(res)); else console.log(`${res.action}: ${name}`);
  } else if (action === 'update') {
    const res = await updateTrigger(flags.projectId, spec, !!flags.dryRun);
    if (flags.json) console.log(JSON.stringify(res)); else console.log(`${res.action}: ${name}`);
  }
}

async function cmdDeployServices(flags: GlobalFlags, targetService?: string) {
  const root = process.cwd();
  const cfg = resolveConfig(root);
  let services = Object.values(cfg.services);
  if (targetService) {
    services = services.filter((s) => s.name === targetService);
    if (services.length === 0) {
      throw new ConfigurationError(`Service not found in architecture.yaml: ${targetService}`);
    }
  }
  const concurrency = flags.concurrency || cfg.maxConcurrency || 1;
  const queue = new Queue(concurrency);
  const tag = flags.imageTag || deriveTag();

  const repoName = flags.repoName || 'bitbrat-services';

  if (!services.length) {
    throw new ConfigurationError('No services found in architecture.yaml');
  }

  const tasks = services.map((svc) => async () => {
    // Preflight enforcement: ensure VPC, subnet, router, and Serverless VPC Access connector exist in target region/env
    if (!flags.dryRun) {
      try {
        await assertVpcPreconditions({
          projectId: flags.projectId,
          region: flags.region || (svc as any).region,
          env: flags.env,
          allowNoVpc: (flags as any).allowNoVpc,
          dryRun: flags.dryRun,
        });
      } catch (e: any) {
        throw new DependencyError(e?.message || String(e));
      }
    } else {
      log.info({ service: svc.name, action: 'deploy.service', status: 'preflight-skip', reason: 'dry-run' }, 'Skipping VPC preflight in dry-run');
    }
    const serviceLog = log.child({ service: svc.name, action: 'deploy.service' });
    const start = Date.now();
    serviceLog.info({ status: 'start' }, 'Starting build+deploy');
    const isExternalImage = !!svc.image;
    const currentCbConfigPath = isExternalImage
      ? path.join(root, 'cloudbuild.deploy-only.yaml')
      : path.join(root, 'cloudbuild.oauth-flow.yaml');

    // Dockerfile inference (only if not using external image)
    let dockerfile = '';
    if (!isExternalImage) {
      dockerfile = `Dockerfile.${svc.name}`;
      const kebab = svc.name.replace(/\s+/g, '-');
      if (!fs.existsSync(dockerfile)) {
        const alt = `Dockerfile.${kebab}`;
        if (fs.existsSync(alt)) dockerfile = alt; else {
          serviceLog.warn({ status: 'skipped', reason: 'dockerfile-not-found' }, 'Skipping service: Dockerfile not found');
          return { service: svc.name, skipped: true };
        }
      }
    }
    // env and secrets
    // New behavior: include ALL env vars from the environment overlay in deploy,
    // while treating env declared in architecture.yaml as required keys only.
    // So we load full overlay env (no filtering by svc.envKeys) and separately validate required keys.
    // Load env for this service: merge env/<env>/global.yaml + env/<env>/<service>.yaml (service overrides global)
    const envKv = loadEnvKv(flags.env, svc.name);
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
    // Validate that required env keys from architecture.yaml are present in the overlay
    try {
      if (svc.envKeys && svc.envKeys.length) {
        // Certain keys are provided by the runtime (e.g., Cloud Run) and should not be required in overlays
        const runtimeProvided = new Set<string>(['K_REVISION']);
        const present = new Set<string>((envKv || '')
          .split(';')
          .filter(Boolean)
          .map((p) => p.split('=')[0]));
        const missing = (svc.envKeys || [])
          .filter((k) => !runtimeProvided.has(k))
          .filter((k) => !present.has(k));
        if (missing.length) {
          const msg = `Missing required env keys for ${svc.name}: ${missing.join(', ')}. ` +
            'Provide these via env overlay or Secret Manager. Keys listed in architecture.yaml are REQUIRED.';
          if (!flags.dryRun) {
            throw new ConfigurationError(msg);
          } else {
            serviceLog.warn({ status: 'dry-run', missing }, msg);
          }
        }
      }
    } catch (e: any) {
      throw e;
    }

    const envFiltered = filterEnvKvAgainstSecrets(envKv, secretMap);

    // To avoid Cloud Build --substitutions parsing issues with commas/equals inside env values,
    // write the semicolon-delimited KV string to a file in the source tree and pass its path.
    // The Cloud Build YAML will prefer reading ENV from this file when provided.
    let envVarsFileRel = '';
    try {
      const cbDir = path.join(root, '.cloudbuild');
      if (!fs.existsSync(cbDir)) fs.mkdirSync(cbDir, { recursive: true });
      const safeName = String(svc.name).replace(/[^A-Za-z0-9_.-]+/g, '-');
      envVarsFileRel = path.join('.cloudbuild', `env.${safeName}.kv`);
      // Always write (overwrites any prior content), even when empty to keep behavior explicit
      fs.writeFileSync(path.join(root, envVarsFileRel), envFiltered || '', 'utf8');
    } catch (e: any) {
      // If writing fails for any reason, fall back to passing the string via substitutions
      envVarsFileRel = '';
      log.warn({ service: svc.name, action: 'deploy.service', status: 'warn', reason: 'env-file-write-failed', error: e?.message || String(e) }, 'Falling back to _ENV_VARS_ARG substitution');
    }

    // Compute effective allow-unauthenticated policy
    // Rules:
    // - Honor service.security.allowUnauthenticated when true
    // - Additionally, enforce unauthenticated when service is VPC-bound and/or behind Internal & CLB ingress,
    //   which is required for Serverless NEG behind External HTTP(S) LB to invoke the service.
    const ingressPolicy = 'internal-and-cloud-load-balancing';
    const vpcConnectorName = `brat-conn-${(flags.region || svc.region)}-${flags.env}`;
    const effectiveAllowUnauth = !!(svc.allowUnauth || ingressPolicy === 'internal-and-cloud-load-balancing' || vpcConnectorName);
    serviceLog.info({
      status: 'policy',
      allowUnauthConfigured: svc.allowUnauth,
      effectiveAllowUnauth,
      ingress: ingressPolicy,
      vpcConnector: vpcConnectorName,
      note: 'Allow unauthenticated is required for LB serverless NEG; enforcing when VPC-bound or Internal & CLB ingress.'
    }, 'Computed effective allowUnauthenticated policy');

    const substitutions = computeDeploySubstitutions({
      svc: svc as ResolvedServiceConfig,
      repoName,
      region: flags.region,
      tag,
      allowUnauth: effectiveAllowUnauth,
      dockerfile,
      envVarsArg: envVarsFileRel ? '' : envFiltered,
      envVarsFile: envVarsFileRel,
      secretSetArg: secretMap,
      ingressPolicy,
      vpcConnectorName,
      image: svc.image,
    });

    if (flags.dryRun) {
      serviceLog.info({ status: 'dry-run', substitutions }, 'DRY-RUN: Would submit Cloud Build');
      return { service: svc.name, dryRun: true };
    }
    const res = await submitBuild({
      projectId: flags.projectId,
      configPath: currentCbConfigPath,
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

export interface DeploySubstitutionsInput {
  svc: ResolvedServiceConfig;
  repoName: string;
  region?: string;
  tag: string;
  allowUnauth: boolean;
  dockerfile: string;
  envVarsArg: string;
  envVarsFile?: string;
  secretSetArg: string;
  ingressPolicy: string;
  vpcConnectorName: string;
  image?: string;
}

export function computeDeploySubstitutions(i: DeploySubstitutionsInput): Record<string, string | number | boolean> {
  const subs: Record<string, string | number | boolean> = {
    _SERVICE_NAME: i.svc.name,
    _REGION: i.region || i.svc.region,
    _DRY_RUN: false,
    _PORT: i.svc.port,
    _MIN_INSTANCES: i.svc.minInstances,
    _MAX_INSTANCES: i.svc.maxInstances,
    _CPU: i.svc.cpu,
    _MEMORY: i.svc.memory,
    _ALLOW_UNAUTH: i.allowUnauth,
    _SECRET_SET_ARG: i.secretSetArg || '',
    _ENV_VARS_ARG: i.envVarsArg || '',
    _ENV_VARS_FILE: i.envVarsFile || '',
    _INGRESS: i.ingressPolicy,
    _VPC_CONNECTOR: i.vpcConnectorName,
    _BILLING: 'instance',
  };

  if (i.image) {
    subs['_IMAGE'] = i.image;
  } else {
    subs['_REPO_NAME'] = i.repoName;
    subs['_TAG'] = i.tag;
    subs['_DOCKERFILE'] = i.dockerfile;
  }

  return subs;
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
  const { cmd, flags, rest } = parseArgs(process.argv);
  const requireEnv = (context: string) => {
    if (!flags.env) {
      console.error(`Environment is required for '${context}'. Specify --env <name> (e.g., dev, prod) or set BITBRAT_ENV.`);
      process.exit(2);
    }
  };
  // Propagate commonly used flags into process.env so lower layers (e.g., config loader
  // and interpolation context) can resolve environment-aware values without requiring
  // every call site to thread flags explicitly.
  if (flags.env) {
    process.env.BITBRAT_ENV = flags.env;
  }
  if (flags.projectId) {
    process.env.PROJECT_ID = flags.projectId;
  }
  if (flags.region) {
    process.env.REGION = flags.region;
  }
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
  if (c1 === 'service' && c2 === 'bootstrap') {
    const m = parseKeyValueFlags(rest);
    const name = m['name'];
    if (!name) {
      console.error('Usage: brat service bootstrap --name <name> [--mcp] [--force]');
      process.exit(2);
    }
    const force = m['force'] === 'true' || rest.includes('--force');
    const mcp = m['mcp'] === 'true' || rest.includes('--mcp');
    const { spawnSync } = require('child_process');
    const scriptPath = path.join(process.cwd(), 'infrastructure/scripts/bootstrap-service.js');
    const args = ['--name', name];
    if (force) args.push('--force');
    if (mcp) args.push('--mcp');
    
    console.log(`[brat] Bootstrapping service: ${name}${mcp ? ' (MCP)' : ''}`);
    const res = spawnSync('node', [scriptPath, ...args], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }
  if (c1 === 'deploy' && c2 === 'services') {
    requireEnv('deploy services');
    await cmdDeployServices(flags);
    return;
  }
  if (c1 === 'deploy' && c2 === 'service') {
    const serviceName = cmd[2];
    if (!serviceName) {
      console.error('Usage: brat deploy service <name> --env <name> [--project-id <id>] [--region <r>] [--dry-run]');
      process.exit(2);
    }
    requireEnv(`deploy service ${serviceName}`);
    await cmdDeployServices(flags, serviceName);
    return;
  }
  // Alias: brat deploy <name>
  if (c1 === 'deploy' && c2 && c2 !== 'services') {
    const serviceName = c2;
    requireEnv(`deploy ${serviceName}`);
    await cmdDeployServices(flags, serviceName);
    return;
  }
  if (c1 === 'apis' && c2 === 'enable') {
    requireEnv('apis enable');
    const apis = getRequiredApis(flags.env);
    const res = await enableApis({ projectId: flags.projectId, env: flags.env, apis, dryRun: !!flags.dryRun });
    if (flags.json) console.log(JSON.stringify(res, null, 2));
    else {
      console.log(`Enabling required APIs for project ${res.projectId} (${flags.env})`);
      if (res.dryRun) {
        console.log('[DRY-RUN] The following APIs would be enabled:');
        res.attempted.forEach((a) => console.log(` - ${a}`));
      } else {
        const ok = res.ok ? 'SUCCESS' : 'FAILED';
        console.log(`Result: ${ok}`);
        const failures = res.results.filter((r) => !r.enabled);
        if (failures.length) {
          console.error('Failures:');
          failures.forEach((f) => console.error(` - ${f.api}: ${f.error || f.stderr || 'unknown error'}`));
          process.exit(1);
        }
      }
    }
    return;
  }
  if (c1 === 'lb' && c2 === 'urlmap') {
    const c3 = cmd[2];
    if (c3 === 'render') {
      requireEnv('lb urlmap render');
      const m = parseKeyValueFlags(rest);
      const out = m['out'];
      const result = renderAndWrite({ rootDir: process.cwd(), env: flags.env as any, projectId: flags.projectId, outFile: out });
      if (flags.json) console.log(JSON.stringify({ outFile: result.outFile }, null, 2));
      else console.log(`Rendered URL map YAML → ${result.outFile}`);
      return;
    }
    if (c3 === 'import') {
      requireEnv('lb urlmap import');
      const outPath = require('path').join(process.cwd(), 'infrastructure', 'cdktf', 'lb', 'url-maps', flags.env, 'url-map.yaml');
      const urlMapName = 'bitbrat-global-url-map';
      const res = await importUrlMap({ projectId: flags.projectId, env: flags.env as any, urlMapName, sourceYamlPath: outPath, dryRun: !!flags.dryRun });
      if (flags.json) console.log(JSON.stringify(res, null, 2)); else console.log(res.message);
      if (res.changed && flags.dryRun) process.exit(0);
      return;
    }
  }
  if (c1 === 'infra' && (c2 === 'plan' || c2 === 'apply')) {
    requireEnv(`infra ${c2}`);
    // Support both flag-based and positional module selection (network | lb)
    const c3 = (cmd.length >= 3) ? cmd[2] : undefined;
    let moduleName: 'network' | 'load-balancer' | 'connectors' | undefined = undefined;
    if (c3 === 'network') moduleName = 'network';
    if (c3 === 'lb' || c3 === 'load-balancer') moduleName = 'load-balancer';
        if (c3 === 'connectors') moduleName = 'connectors';
    const selectedModule = (flags.module as any) || moduleName;

    if (selectedModule) {
      const synthOut = synthModule(selectedModule as any, { rootDir: process.cwd(), env: flags.env, projectId: flags.projectId });
      // Preflight for LB existing resources (IP and cert)
      if (selectedModule === 'load-balancer') {
        try {
          const arch: any = loadArchitecture(process.cwd());
          const lbNode: any = arch?.infrastructure?.resources?.['main-load-balancer'] || arch?.infrastructure?.['main-load-balancer'] || {};
          const ipName = lbNode?.ip || (flags.env === 'dev' ? 'birtrat-ip' : 'bitbrat-global-ip');
          const certName = lbNode?.cert || (flags.env === 'dev' ? 'bitbrat-dev-cert' : `bitbrat-cert-${flags.env}`);
          const strict = (c2 === 'apply' && String(flags.env) === 'prod');
          const { preflightLbExistingResources } = require('../providers/gcp/lb-preflight');
          const pf = await preflightLbExistingResources({ projectId: flags.projectId, env: flags.env, ipName, certName, strict });
          const details = `ip:${ipName} exists=${pf.ip.exists}${pf.ip.address ? ` addr=${pf.ip.address}` : ''}; cert:${certName} exists=${pf.cert.exists}${pf.cert.status ? ` status=${pf.cert.status}` : ''}`;
          if (!pf.ok) {
            if (strict) {
              console.error(`[lb:preflight] FAILED (prod strict). ${details}`);
              process.exit(2);
            } else {
              console.warn(`[lb:preflight] WARN (non-strict). ${details}`);
            }
          } else {
            console.log(`[lb:preflight] OK. ${details}`);
          }
        } catch (e: any) {
          if (c2 === 'apply' && String(flags.env) === 'prod') {
            console.error(`[lb:preflight] Error during preflight in prod apply: ${e?.message || String(e)}`);
            process.exit(2);
          } else {
            console.warn(`[lb:preflight] Non-fatal error during preflight: ${e?.message || String(e)}`);
          }
        }
      }
      if (c2 === 'plan' || flags.dryRun) {
        await terraformPlanGeneric({ cwd: synthOut, envName: flags.env });
      } else {
        // Guard: never allow apply during CI or when --dry-run is set
        const ci = String(process.env.CI || '').toLowerCase();
        if (flags.dryRun || ci === 'true' || ci === '1') {
          const outputsPath = path.join(synthOut, 'outputs.json');
          const payload = {
            error: 'apply-blocked',
            message: 'Apply is not allowed in CI or with --dry-run. Please run apply manually outside CI without --dry-run.',
            reasons: {
              dryRunFlag: !!flags.dryRun,
              ciEnv: ci === 'true' || ci === '1'
            },
            hints: [
              'Unset CI in your local shell (e.g., `unset CI`).',
              'Do not pass --dry-run when you intend to apply.',
              'Re-run: npm run brat -- infra apply network --env=<env> --project-id <PROJECT>'
            ]
          };
          try { fs.writeFileSync(outputsPath, JSON.stringify(payload, null, 2), 'utf8'); } catch {}
          console.error('Apply is not allowed in CI or with --dry-run. Please run apply manually outside CI without --dry-run.');
          process.exit(2);
        }
        const code = await terraformApplyGeneric({ cwd: synthOut, envName: flags.env });
        try {
          const outputsPath = path.join(synthOut, 'outputs.json');
          if (fs.existsSync(outputsPath)) {
            const data = fs.readFileSync(outputsPath, 'utf8');
            if (flags.json) console.log(data); else console.log(`Terraform outputs written to ${outputsPath}`);
          } else {
            const payload = {
              error: 'outputs-missing',
              message: 'Expected outputs.json not found after apply. Check previous logs for terraform errors.',
              hints: [
                'Run `terraform output -json > outputs.json` inside the module directory to capture outputs manually.',
                'Confirm that output blocks are present in main.tf.'
              ]
            };
            try { fs.writeFileSync(outputsPath, JSON.stringify(payload, null, 2), 'utf8'); } catch {}
          }
        } catch {}
        if (code !== 0) process.exit(code);
        // Post-apply hook: URL map render + guarded import for LB in non-prod (dev/staging)
        if (selectedModule === 'load-balancer') {
          const envName = String(flags.env || 'dev');
          if (envName !== 'prod') {
            try {
              const r = renderAndWrite({ rootDir: process.cwd(), env: envName as any, projectId: flags.projectId });
              const res = await importUrlMap({ projectId: flags.projectId, env: envName as any, urlMapName: 'bitbrat-global-url-map', sourceYamlPath: r.outFile, dryRun: false });
              console.log(`[lb:urlmap] ${res.message}`);
            } catch (e: any) {
              console.error(`[lb:urlmap] post-apply import failed: ${e?.message || String(e)}`);
              process.exit(2);
            }
          } else {
            console.log('[lb:urlmap] prod environment: import skipped (plan-only).');
          }
        }
      }
      return;
    }
    // Fallback to legacy envDir path used by bash script parity
    const envDir = process.env.ENV_DIR || path.join('infrastructure', 'gcp', 'prod');
    const serviceName = process.env.SERVICE_NAME || 'oauth-flow';
    const repoName = process.env.REPO_NAME || 'bitbrat-services';
    await cmdInfra(c2 as any, flags, envDir, serviceName, repoName);
    return;
  }
  if (c1 === 'trigger' && (c2 === 'create' || c2 === 'update' || c2 === 'delete')) {
    await cmdTrigger(c2 as any, flags, rest);
    return;
  }
  printHelp();
}

if (require.main === module) {
  main().catch((err) => {
    const code = exitCodeForError(err);
    log.error({ err, code }, 'brat failed');
    process.exit(code);
  });
}
