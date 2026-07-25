/**
 * brat deploy service <name>
 *
 * Sprint 362: Deploy command migration (Pattern 1: Simple Delegation)
 *
 * Deploys a single service by name to the target environment.
 * Identical to "deploy services --all" but with single service targeting.
 */

import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { resolveConfig } from '../../config/loader';
import { selectDeployableServices, computeDeploySubstitutions } from '../../cli/index';
import { submitBuild } from '../../providers/gcp/cloudbuild';
import { assertVpcPreconditions } from '../../providers/gcp/preflight';
import { deriveTag } from '../../util/git';
import { DependencyError, ConfigurationError } from '../../orchestration/errors';
import * as fs from 'fs';
import * as path from 'path';

export default class DeployService extends BratCommand {
  static override description = 'Deploy a single service by name to target environment';

  static override examples = [
    '<%= config.bin %> <%= command.id %> api-gateway --context staging',
    '<%= config.bin %> <%= command.id %> llm-bot --dry-run',
    '<%= config.bin %> <%= command.id %> event-router --allow-no-vpc',
  ];

  static override args = {
    name: Args.string({
      description: 'Service name to deploy',
      required: true,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID (default: from architecture.yaml)',
      required: false,
    }),
    region: Flags.string({
      description: 'GCP region (default: from service config)',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview deployment without executing',
      default: false,
    }),
    'allow-no-vpc': Flags.boolean({
      description: 'Skip VPC preflight checks',
      default: undefined,
    }),
    'image-tag': Flags.string({
      description: 'Docker image tag (default: git-derived)',
      required: false,
    }),
    repo: Flags.string({
      description: 'Artifact Registry repository name',
      default: 'bitbrat-services',
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(DeployService);

    const serviceName = args.name as string;

    // Resolve configuration
    const root = this.repoRoot;
    const cfg = resolveConfig(root);

    // Get project ID (flag > env)
    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    // Get environment name from context
    const envName = this.context.name;

    // Select single service (throws if not found or inactive)
    const services = selectDeployableServices(Object.values(cfg.services), serviceName);

    if (!services.length) {
      throw new ConfigurationError(`Service '${serviceName}' not found or inactive in architecture.yaml`);
    }

    const svc = services[0];

    this.logger.info({ action: 'deploy.service.start', service: svc.name, env: envName }, `Deploying service: ${svc.name}`);

    // VPC preflight check (unless dry-run or allow-no-vpc)
    if (!flags['dry-run']) {
      try {
        await assertVpcPreconditions({
          projectId,
          region: flags.region || svc.region,
          env: envName,
          allowNoVpc: flags['allow-no-vpc'],
          dryRun: flags['dry-run'],
        });
      } catch (e: any) {
        throw new DependencyError(e?.message || String(e));
      }
    } else {
      this.logger.info({ status: 'preflight-skip', reason: 'dry-run' }, 'Skipping VPC preflight in dry-run');
    }

    const start = Date.now();
    const tag = flags['image-tag'] || deriveTag();
    const repoName = flags.repo;

    const isExternalImage = !!svc.image;
    const currentCbConfigPath = isExternalImage
      ? path.join(root, 'cloudbuild.deploy-only.yaml')
      : path.join(root, 'cloudbuild.oauth-flow.yaml');

    // Dockerfile inference
    let dockerfile = '';
    if (!isExternalImage) {
      dockerfile = `Dockerfile.${svc.name}`;
      const kebab = svc.name.replace(/\s+/g, '-');
      if (!fs.existsSync(path.join(root, dockerfile))) {
        const alt = `Dockerfile.${kebab}`;
        if (fs.existsSync(path.join(root, alt))) {
          dockerfile = alt;
        } else {
          throw new ConfigurationError(`Dockerfile not found: ${dockerfile} or ${alt}`);
        }
      }
    }

    // Load environment variables
    const { loadEnvKv, synthesizeSecretMapping, filterEnvKvAgainstSecrets } = await import('../../config/loader');
    const { resolveSecretMappingToNumeric } = await import('../../providers/gcp/secrets');

    const envKv = loadEnvKv(envName, svc.name);
    let secretMap = synthesizeSecretMapping(svc.secrets);
    if (secretMap) {
      try {
        const resolved = await resolveSecretMappingToNumeric(secretMap, projectId);
        if (resolved) secretMap = resolved;
      } catch (e: any) {
        if (!flags['dry-run']) {
          throw new DependencyError(e?.message || String(e));
        } else {
          this.logger.warn(
            { status: 'dry-run', reason: 'missing-secret-versions', error: e?.message || String(e) },
            'DRY-RUN: would fail due to missing secret versions'
          );
        }
      }
    }

    // Validate required env keys
    if (svc.envKeys && svc.envKeys.length) {
      const runtimeProvided = new Set<string>(['K_REVISION']);
      const present = new Set<string>(
        (envKv || '')
          .split(';')
          .filter(Boolean)
          .map((p) => p.split('=')[0])
      );
      const missing = (svc.envKeys || []).filter((k) => !runtimeProvided.has(k)).filter((k) => !present.has(k));
      if (missing.length) {
        const msg = `Missing required env keys for ${svc.name}: ${missing.join(', ')}`;
        if (!flags['dry-run']) {
          throw new ConfigurationError(msg);
        } else {
          this.logger.warn({ status: 'dry-run', missing }, msg);
        }
      }
    }

    const envFiltered = filterEnvKvAgainstSecrets(envKv, secretMap);

    // Write env vars to file
    let envVarsFileRel = '';
    try {
      const cbDir = path.join(root, '.cloudbuild');
      if (!fs.existsSync(cbDir)) fs.mkdirSync(cbDir, { recursive: true });
      const safeName = String(svc.name).replace(/[^A-Za-z0-9_.-]+/g, '-');
      envVarsFileRel = path.join('.cloudbuild', `env.${safeName}.kv`);
      fs.writeFileSync(path.join(root, envVarsFileRel), envFiltered || '', 'utf8');
    } catch (e: any) {
      envVarsFileRel = '';
      this.logger.warn({ reason: 'env-file-write-failed', error: e?.message || String(e) }, 'Falling back to _ENV_VARS_ARG');
    }

    // Compute substitutions
    const ingressPolicy = 'internal-and-cloud-load-balancing';
    const vpcConnectorName = `brat-conn-${flags.region || svc.region}-${envName}`;
    const effectiveAllowUnauth = !!(svc.allowUnauth || ingressPolicy === 'internal-and-cloud-load-balancing' || vpcConnectorName);

    const substitutions = computeDeploySubstitutions({
      svc,
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

    if (flags['dry-run']) {
      this.logger.info({ status: 'dry-run', substitutions }, 'DRY-RUN: Would submit Cloud Build');
      this.log(`[DRY-RUN] Would deploy service: ${svc.name}`);
      return;
    }

    // Submit Cloud Build
    const res = await submitBuild({
      projectId,
      configPath: currentCbConfigPath,
      substitutions,
      cwd: root,
      dryRun: false,
      onStdout: (chunk) => {
        chunk.split(/\r?\n/).filter(Boolean).forEach((line) => this.logger.info({ stream: 'stdout' }, line));
      },
      onStderr: (chunk) => {
        chunk.split(/\r?\n/).filter(Boolean).forEach((line) => this.logger.warn({ stream: 'stderr' }, line));
      },
    });

    const durationMs = Date.now() - start;
    if (res.code !== 0) {
      this.logger.error({ status: 'failed', code: res.code, durationMs }, 'Cloud Build failed');
      throw new DependencyError(`Cloud Build failed for ${svc.name}: ${res.stderr || res.stdout}`);
    }

    this.logger.info({ status: 'success', durationMs }, 'Build+deploy finished');
    this.log(`✅ Successfully deployed ${svc.name} (${durationMs}ms)`);
  }
}
