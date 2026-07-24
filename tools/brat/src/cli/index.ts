#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
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
import { cmdDocker } from './docker';
import { createTrigger, updateTrigger, deleteTrigger } from '../providers/gcp/cloudbuild-triggers';
import { assertVpcPreconditions } from '../providers/gcp/preflight';
import { renderAndWrite } from '../lb/urlmap';
import { importUrlMap } from '../lb/importer';
import { enableApis, getRequiredApis } from '../providers/gcp/apis';
import { cmdSetup } from './setup';
import { cmdBackup } from './backup';
import { cmdMigrate } from './migrate';
import { cmdPgBackup, cmdPgRestore } from './pg-backup';
import { cmdDbValidate } from './db-validate';
import { cmdSeed, printSeedHelp } from './seed';

const RUN_ID = deriveTag();
const log = createLogger({ base: { runId: RUN_ID, component: 'brat' } });

interface GlobalFlags {
  projectId: string;
  region?: string;
  env: string; // DEPRECATED: Use context instead (Sprint 349+)
  context?: string; // Sprint 349+: Execution context name
  dryRun: boolean;
  concurrency?: number;
  json?: boolean;
  module?: string;
  allowNoVpc?: boolean;
  ci?: boolean;
  imageTag?: string;
  repoName?: string;
  envExplicit?: boolean; // DEPRECATED: Tracks if --env was explicitly set
  contextExplicit?: boolean; // Sprint 349+: Tracks if --context was explicitly set
  target?: string; // DEPRECATED: Use context instead (Sprint 349+)
  targetExplicit?: boolean; // DEPRECATED: Tracks if --target was explicitly set
  url?: string;
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
    else if (a === '--context') { flags.context = String(args[++i]); (flags as any).contextExplicit = true; }
    else if (a === '--env') {
      flags.env = String(args[++i]);
      (flags as any).envExplicit = true;
      // Map --env to --context for backward compatibility
      if (!flags.context) {
        flags.context = flags.env;
      }
    }
    else if (a === '--target') {
      (flags as any).target = String(args[++i]);
      (flags as any).targetExplicit = true;
      // Map --target to --context for backward compatibility
      if (!flags.context) {
        flags.context = (flags as any).target;
      }
    }
    else if (a === '--dry-run') { flags.dryRun = true; }
    else if (a === '--concurrency') { flags.concurrency = Number(args[++i]); }
    else if (a === '--json') { flags.json = true; }
    else if (a === '--module') { flags.module = String(args[++i]); }
    else if (a === '--allow-no-vpc') { (flags as any).allowNoVpc = true; }
    else if (a === '--ci') { flags.ci = true; }
    else if (a === '--image-tag') { flags.imageTag = String(args[++i]); }
    else if (a === '--repo') { flags.repoName = String(args[++i]); }
    else if (a === '--url' || a === '-u') { flags.url = String(args[++i]); }
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
  brat setup [--projectId <id>] [--openaiKey <key>] [--botName <name>]
  brat doctor [--json] [--ci]
  brat config show [--json]
  brat config validate [--json]

  brat bit create <name> [--profile <p>] [--exposure <e>] [--kind <k>] [--register] [--active] [--force]

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

  brat chat [--env <name>] [--project-id <id>]

  # Launch a coding agent (Claude Code, Aider, Continue, OpenHands) preconfigured for this project
  brat code [--agent <agent>] [--list] [--project-root <path>] [-- <agent-args>...]

  # Execution context management (Sprint 349+)
  brat use <context>              # Switch to a different execution context (local, staging, prod)
  brat current                    # Show current execution context

  # Global flags:
  --context <name>                # Execution context (local, staging, prod) - overrides ~/.bratrc
  --env <name>                    # DEPRECATED: Use --context instead (removed in Sprint 352)
  --target <name>                 # DEPRECATED: Use --context instead (removed in Sprint 352)

  # Fleet control plane (drives the universal bit.* tools via the tool-gateway fabric; fail-closed RBAC)
  brat fleet list [--json]
  brat fleet info|health [<bit> | --all] [--json]
  brat fleet config <bit> [--describe] [--json]
  brat fleet flags <bit> get [--key K] | set --key K --value V [--json]
  brat fleet log <bit> --level <error|warn|info|debug>
  brat fleet drain|shutdown <bit> [--all --confirm]
  brat fleet ... [--direct <bit>]   # BREAK-GLASS: bypass the gateway (audited; single-Bit; never with --all)

  brat cloud-run shutdown --env <name> [--project-id <id>] [--region <r>] [--dry-run]

  # Cut a platform version (single source of truth: architecture.yaml project.version)
  brat release <patch|minor|major|x.y.z> [--dry-run] [--tag] [--yes]

  brat trigger create --name <n> --repo <owner/repo> --branch <regex> --config <path> [--dry-run]
  brat trigger update --name <n> --repo <owner/repo> --branch <regex> --config <path> [--dry-run]
  brat trigger delete --name <n> [--dry-run]

  brat docker up [--target <name>] [--env <name>] [--service <name>] [--loki] [--no-deps] [--force-recreate] [--no-cache] [--dry-run]
  brat docker down [--target <name>] [--service <name>] [--dry-run]
  brat docker logs [--target <name>] [--service <name>] [--follow]
  brat docker ps [--target <name>] [--service <name>]

  # --no-deps: Don't start linked services (nats, firebase-emulator) when using --service
  # --force-recreate: Force recreate containers even if config unchanged (fixes port conflicts)
  # --no-cache: Build images without using Docker cache (forces fresh build)

  # MCP server setup for LLM agents (Claude Code, etc.)
  brat mcp setup [--target <name>] [--scope local|user|project] [--server-name <name>] [--log-level <level>] [--dry-run] [--json]

  # Firestore config backup/restore (config collections only; events & log collections are NEVER exported)
  brat backup list [--json]
  brat backup export [--project-id <id> | --target <name>] [--out <path>] [--collections a,b] [--include-secrets] [--pretty] [--json]
  brat backup import --in <path> [--project-id <id> | --target <name>] [--mode merge|overwrite|skip] [--collections a,b] [--include-secrets] [--dry-run] [--confirm] [--json]
      # import is DRY-RUN by default; pass --confirm to write. --target <local|staging> targets a docker-stack Firestore emulator.

  # Database seeding (populate initial data for routing, reflexes, personalities)
  brat seed [--context <name>] [--bot-name <name>] [--dry-run] [--wipe] [--json]

  # Database migration (Firestore → PostgreSQL)
  brat migrate collection <name> [--dry-run] [--json]
  brat migrate all [--dry-run] [--json]

  # PostgreSQL backup/restore
  brat pg:backup [--output <path>] [--format json|sql] [--compress] [--collections a,b] [--json]
  brat pg:restore --input <path> [--format json|sql] [--mode merge|overwrite] [--dry-run] [--json]

  # Database validation (Firestore vs PostgreSQL consistency check)
  brat db:validate [--collection <name> | --all] [--sample N] [--json]

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
  const raw = yaml.load(src) as any;

  const issues: Array<{ path: string; message: string; code: string }> = [];

  // 1) Structural validation against the runtime Zod schema (source of truth for the tooling).
  const parsed = ArchitectureSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ path: i.path.join('.'), message: i.message, code: i.code });
    }
  }

  // 2) Validation against the shipped, published JSON Schema so humans and agents can self-validate
  //    architecture.yaml (path resolved from references.architecture_schema, with a sensible default).
  const schemaRel: string =
    (raw && raw.references && raw.references.architecture_schema) || 'documentation/schemas/architecture.v1.json';
  const schemaPath = path.join(root, schemaRel);
  if (!fs.existsSync(schemaPath)) {
    issues.push({ path: schemaRel, message: `Referenced architecture schema not found at ${schemaRel}`, code: 'schema-missing' });
  } else {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      if (!validate(raw)) {
        for (const e of validate.errors || []) {
          const p = (e.instancePath || '').replace(/^\//, '').replace(/\//g, '.');
          issues.push({ path: p || '(root)', message: `${e.message}`, code: 'json-schema' });
        }
      }
    } catch (e: any) {
      issues.push({ path: schemaRel, message: `Failed to load/compile JSON schema: ${e.message}`, code: 'schema-load' });
    }
  }

  if (issues.length === 0) {
    const out = { valid: true, schema: schemaRel };
    if (flags.json) console.log(JSON.stringify(out, null, 2)); else console.log(`Config valid (validated against ${schemaRel})`);
    return;
  }
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

/**
 * Select which services should be built/deployed.
 *
 * Parity with the IaC synth path (cdktf-synth.ts): only services with `active === true` are
 * deployable. An absent/false `active` means the service is DISABLED
 * (architecture.yaml defaults.services.active).
 *
 * - `--all` (no target): inactive services are silently filtered out (with a structured skip log).
 * - explicit target: an unknown name OR an inactive service fails fast with a ConfigurationError,
 *   so a directly requested service is never silently dropped.
 */
export function selectDeployableServices(
  allServices: ResolvedServiceConfig[],
  targetService?: string,
): ResolvedServiceConfig[] {
  if (targetService) {
    const matches = allServices.filter((s) => s.name === targetService);
    if (matches.length === 0) {
      throw new ConfigurationError(`Service not found in architecture.yaml: ${targetService}`);
    }
    // An explicitly named target that is inactive must fail fast rather than silently deploy or skip.
    if (!matches[0].active) {
      throw new ConfigurationError(
        `Service '${targetService}' is inactive (active:false) and cannot be deployed. ` +
        `Set active:true in architecture.yaml to deploy it.`
      );
    }
    return matches;
  }
  return allServices.filter((svc) => {
    if (svc.active) return true;
    log.info({ service: svc.name, action: 'deploy.service', status: 'skipped', reason: 'inactive' }, 'Skipping inactive service');
    return false;
  });
}

async function cmdDeployServices(flags: GlobalFlags, targetService?: string) {
  const root = process.cwd();
  const cfg = resolveConfig(root);
  let services = selectDeployableServices(Object.values(cfg.services), targetService);
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

async function cmdCloudRunShutdown(flags: GlobalFlags) {
  const root = process.cwd();
  const cfg = resolveConfig(root);
  const services = Object.values(cfg.services);
  if (!services.length) {
    throw new ConfigurationError('No services found in architecture.yaml');
  }

  log.info({ action: 'cloud-run.shutdown.start', env: flags.env, projectId: flags.projectId }, `Shutting down ${services.length} Cloud Run services`);

  for (const svc of services) {
    const region = flags.region || svc.region;
    const serviceName = svc.name;
    const serviceLog = log.child({ service: serviceName, region });

    serviceLog.info({ status: 'scaling-zero' }, `Scaling ${serviceName} to zero instances`);

    const args = [
      'run', 'services', 'update', serviceName,
      '--min-instances=0',
      '--region', region,
      '--project', flags.projectId,
      '--quiet'
    ];

    if (flags.dryRun) {
      serviceLog.info({ status: 'dry-run', command: `gcloud ${args.join(' ')}` }, `DRY-RUN: Would scale ${serviceName} to zero`);
      continue;
    }

    try {
      const res = await execCmd('gcloud', args);
      if (res.code !== 0) {
        serviceLog.error({ status: 'failed', code: res.code, stderr: res.stderr }, `Failed to scale ${serviceName} to zero`);
        // Continue with other services even if one fails
      } else {
        serviceLog.info({ status: 'success' }, `Successfully scaled ${serviceName} to zero`);
      }
    } catch (e: any) {
      serviceLog.error({ status: 'error', error: e?.message || String(e) }, `Error scaling ${serviceName} to zero`);
    }
  }

  log.info({ action: 'cloud-run.shutdown.complete' }, 'Cloud Run shutdown completed');
}

/**
 * Print deprecation warnings for legacy flags (Sprint 349+)
 */
function printDeprecationWarnings(flags: GlobalFlags): void {
  const warnings: string[] = [];

  if ((flags as any).envExplicit) {
    warnings.push(
      '⚠️  --env is deprecated and will be removed in Sprint 352.',
      '   Use --context or "brat use <context>" instead.',
      `   Your --env=${flags.env} has been mapped to --context=${flags.context}`
    );
  }

  if ((flags as any).targetExplicit) {
    warnings.push(
      '⚠️  --target is deprecated and will be removed in Sprint 352.',
      '   Use --context or "brat use <context>" instead.',
      `   Your --target=${(flags as any).target} has been mapped to --context=${flags.context}`
    );
  }

  if (warnings.length > 0) {
    console.error(''); // blank line
    warnings.forEach(w => console.error(w));
    console.error(''); // blank line
  }
}

async function main() {
  const { cmd, flags, rest } = parseArgs(process.argv);

  // Print deprecation warnings for legacy flags (Sprint 349+)
  printDeprecationWarnings(flags);
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
  if (c1 === 'setup') {
    if (rest.includes('--help') || rest.includes('-h')) {
      console.log(`brat setup — Interactive platform initialization

Usage:
  brat setup [--project-id <id>] [--openai-key <key>] [--bot-name <name>]

Options:
  --project-id  GCP Project ID
  --openai-key  OpenAI API Key
  --bot-name     Name of the bot
`);
      return;
    }
    const m = parseKeyValueFlags(rest);
    const opts = {
      projectId: m['projectId'] || m['project-id'] || (flags.envExplicit ? flags.projectId : undefined),
      openaiKey: m['openaiKey'] || m['openai-key'],
      botName: m['botName'] || m['bot-name'],
    };
    await cmdSetup(opts, log);
    return;
  }
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
  if (c1 === 'chat') {
    const { cmdChat } = require('./chat');
    await cmdChat(flags, rest);
    return;
  }
  if (c1 === 'code') {
    const { cmdCode } = require('./code/code-command');
    await cmdCode(cmd, rest);
    return;
  }
  if (c1 === 'use') {
    const contextName = c2;
    if (!contextName) {
      console.error('Usage: brat use <context>');
      console.error('\nAvailable contexts are defined in architecture.yaml under executionContexts.');
      console.error('Example: brat use local');
      process.exit(2);
    }
    const { executeUse } = require('../commands/use');
    try {
      await executeUse(contextName);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    return;
  }
  if (c1 === 'current') {
    const { executeCurrent } = require('../commands/current');
    executeCurrent();
    return;
  }
  if (c1 === 'context') {
    const subcommand = c2;
    if (!subcommand || subcommand === 'help' || subcommand === '--help') {
      console.log('Usage: brat context <subcommand>');
      console.log('\nSubcommands:');
      console.log('  list              List all execution contexts');
      console.log('  show <name>       Show full configuration for a context');
      console.log('  create <name>     Create a new execution context');
      console.log('  validate <name>   Validate context configuration');
      console.log('  delete <name>     Delete an execution context (coming soon)');
      console.log('  ping <name>       Test connectivity to context components (coming soon)');
      console.log('\nExamples:');
      console.log('  brat context list');
      console.log('  brat context show staging');
      console.log('  brat context create prod --type cloud-run');
      process.exit(0);
    }
    if (subcommand === 'list') {
      const { executeContextList } = require('../commands/context/list');
      const format = flags.json ? 'json' : 'table';
      await executeContextList({ format });
      return;
    }
    if (subcommand === 'show') {
      const contextName = cmd[2];
      if (!contextName) {
        console.error('Usage: brat context show <name>');
        process.exit(2);
      }
      const { executeContextShow } = require('../commands/context/show');
      const raw = rest.includes('--raw');
      await executeContextShow(contextName, { raw });
      return;
    }
    if (subcommand === 'create') {
      const contextName = cmd[2];
      if (!contextName) {
        console.error('Usage: brat context create <name> [options]');
        process.exit(2);
      }
      const { executeContextCreate } = require('../commands/context/create');

      // Parse flags for non-interactive mode
      const f = flags as any; // Type assertion for dynamic flag access
      const options: any = {};
      if (rest.includes('--non-interactive')) options.nonInteractive = true;
      if (f.type) options.type = f.type;
      if (f.description) options.description = f.description;
      if (f['persistence-driver']) options.persistenceDriver = f['persistence-driver'];
      if (f['pg-host']) options.pgHost = f['pg-host'];
      if (f['pg-port']) options.pgPort = parseInt(f['pg-port'], 10);
      if (f['pg-database']) options.pgDatabase = f['pg-database'];
      if (f['pg-username']) options.pgUsername = f['pg-username'];
      if (f['pg-password']) options.pgPassword = f['pg-password'];
      if (f['docker-host']) options.dockerHost = f['docker-host'];
      if (f['docker-remote-dir']) options.dockerRemoteDir = f['docker-remote-dir'];
      if (f['gcp-project']) options.gcpProject = f['gcp-project'];
      if (f['gcp-region']) options.gcpRegion = f['gcp-region'];
      if (f['gateway-url']) options.gatewayUrl = f['gateway-url'];
      if (f['gateway-auth-token']) options.gatewayAuthToken = f['gateway-auth-token'];
      if (f['env-path']) options.envPath = f['env-path'];
      if (f.tags) options.tags = f.tags;

      await executeContextCreate(contextName, options);
      return;
    }
    if (subcommand === 'validate') {
      const contextName = cmd[2];
      if (!contextName) {
        console.error('Usage: brat context validate <name> [--format json] [--verbose]');
        process.exit(2);
      }
      const { executeContextValidate } = require('../commands/context/validate');
      const format = flags.json ? 'json' : 'text';
      const verbose = rest.includes('--verbose') || rest.includes('-v');
      await executeContextValidate(contextName, { format, verbose });
      return;
    }
    if (subcommand === 'delete' || subcommand === 'ping') {
      console.error(`Error: 'brat context ${subcommand}' is not yet implemented`);
      console.error('');
      console.error('Implemented commands:');
      console.error('  brat context list');
      console.error('  brat context show <name>');
      console.error('  brat context create <name>');
      console.error('  brat context validate <name>');
      console.error('');
      console.error(`The '${subcommand}' command is planned for a future sprint.`);
      process.exit(2);
    }
    console.error(`Unknown context subcommand: ${subcommand}`);
    console.error('Run "brat context help" for usage');
    process.exit(2);
  }
  if (c1 === 'bit') {
    const { cmdBit } = require('./bit');
    await cmdBit(cmd, rest, flags);
    return;
  }
  if (c1 === 'fleet') {
    const { cmdFleet } = require('./fleet');
    await cmdFleet(cmd, rest, flags);
    return;
  }
  if (c1 === 'release') {
    const { cmdRelease } = require('./release');
    await cmdRelease(cmd, rest, flags, log);
    return;
  }
  if (c1 === 'cloud-run' && c2 === 'shutdown') {
    requireEnv('cloud-run shutdown');
    await cmdCloudRunShutdown(flags);
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
      const arch: any = loadArchitecture(process.cwd());
      const lbNode: any = arch?.infrastructure?.resources?.['main-load-balancer'] || arch?.infrastructure?.['main-load-balancer'] || {};
      const urlMapName = lbNode?.name || 'bitbrat-global-url-map';
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
              const res = await importUrlMap({ projectId: flags.projectId, env: envName as any, urlMapName: r.yaml.name, sourceYamlPath: r.outFile, dryRun: false });
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
  if (c1 === 'backup') {
    await cmdBackup(c2, { projectId: flags.projectId, env: flags.env, json: flags.json, dryRun: flags.dryRun }, rest, log);
    return;
  }
  if (c1 === 'migrate') {
    await cmdMigrate(cmd, { json: flags.json, dryRun: flags.dryRun }, rest, log);
    return;
  }
  if (c1 === 'seed') {
    if (rest.includes('--help') || rest.includes('-h')) {
      printSeedHelp();
      return;
    }
    const m = parseKeyValueFlags(rest);
    const seedFlags = {
      context: m['context'] || flags.context || flags.env,
      botName: m['bot-name'] || m['botName'],
      dryRun: rest.includes('--dry-run') || flags.dryRun,
      wipe: rest.includes('--wipe'),
      apiToken: m['api-token'] || m['apiToken'],
      json: flags.json,
    };
    await cmdSeed({}, seedFlags);
    return;
  }
  if (c1 === 'pg:backup') {
    await cmdPgBackup(cmd, { json: flags.json, dryRun: flags.dryRun }, rest, log);
    return;
  }
  if (c1 === 'pg:restore') {
    await cmdPgRestore(cmd, { json: flags.json, dryRun: flags.dryRun }, rest, log);
    return;
  }
  if (c1 === 'db:validate') {
    await cmdDbValidate(cmd, { json: flags.json }, rest, log);
    return;
  }
  if (c1 === 'docker') {
    const action = c2;
    if (!action) {
      console.error('Usage: brat docker <up|down|logs|ps> [--context <name>] [--target <name>] [--env <name>] [--service <name>] [--loki] [--no-deps] [--force-recreate] [--no-cache] [--dry-run]');
      process.exit(2);
    }
    const m = parseKeyValueFlags(rest);
    const dockerFlags = {
      ...flags,
      context: m['context'] || flags.context, // Sprint 349: Execution context support
      target: m['target'],
      service: m['service'],
      follow: rest.includes('--follow') || rest.includes('-f') || m['follow'] === 'true',
      loki: rest.includes('--loki') || m['loki'] === 'true',
      noDeps: rest.includes('--no-deps') || m['no-deps'] === 'true' || m['noDeps'] === 'true',
      forceRecreate: rest.includes('--force-recreate') || m['force-recreate'] === 'true' || m['forceRecreate'] === 'true',
      noCache: rest.includes('--no-cache') || m['no-cache'] === 'true' || m['noCache'] === 'true'
    };
    await cmdDocker(action, dockerFlags);
    return;
  }
  if (c1 === 'dev-mcp') {
    const { cmdDevMcp } = await import('./dev-mcp.js');
    const action = c2;
    if (!action) {
      console.error('Usage: brat dev-mcp start [--target <name>] [--log-level <level>] [--audit-log <path>]');
      process.exit(2);
    }
    const m = parseKeyValueFlags(rest);
    const devMcpFlags = {
      target: m['target'],
      logLevel: m['log-level'] || m['logLevel'] as any,
      auditLog: m['audit-log'] || m['auditLog'],
    };
    await cmdDevMcp(action, devMcpFlags);
    return;
  }
  if (c1 === 'mcp' && c2 === 'setup') {
    const { cmdMcpSetup } = await import('./mcp-setup.js');
    const m = parseKeyValueFlags(rest);
    const mcpSetupFlags = {
      target: m['target'],
      scope: (m['scope'] || 'user') as 'local' | 'user' | 'project',
      serverName: m['server-name'] || m['name'],
      logLevel: (m['log-level'] || m['logLevel'] || 'info') as any,
      auditLog: m['audit-log'] || m['auditLog'],
      dryRun: flags.dryRun,
      json: flags.json,
    };
    await cmdMcpSetup(mcpSetupFlags);
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
